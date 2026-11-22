import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { requireAdminActor } from "../permissions.ts";
import {
	issues,
	issueTypes,
	projects,
	projectWorkflows,
	statuses,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "../schema.ts";
import { workflowDrafts } from "../schema-admin.ts";
import {
	governedBy,
	initialStatusFor,
	moveIssues,
	type StatusRef,
} from "../workflows.ts";
import { audit } from "./audit.ts";
import {
	type Definition,
	definitionSchema,
	describeChanges,
	hasChanges,
	orderStatuses,
	type Problem,
	shapeProblem,
	validateDefinition,
} from "./workflow-definition.ts";

const localSource = () => `local:${randomUUID()}`;

type Executor = Pick<typeof db, "select">;

const idParams = z.object({ id: z.uuid() });
const categorySchema = z.enum(["new", "indeterminate", "done"]);
const statusSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	category: categorySchema,
});

const projectUseSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	name: z.string(),
	issueTypes: z.union([
		z.literal("all"),
		z.array(z.object({ id: z.uuid(), name: z.string() })),
	]),
});
type ProjectUse = z.infer<typeof projectUseSchema>;

const summarySchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	statusCount: z.number().int(),
	transitionCount: z.number().int(),
	hasDraft: z.boolean(),
	updatedAt: z.iso.datetime(),
	projects: z.array(projectUseSchema),
});

const detailSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	hasDraft: z.boolean(),
	mode: z.enum(["draft", "live"]),
	initialStatusId: z.uuid().nullable(),
	statuses: z.array(statusSchema.extend({ issueCount: z.number().int() })),
	transitions: z.array(
		z.object({
			id: z.uuid(),
			name: z.string(),
			fromStatusId: z.uuid().nullable(),
			toStatusId: z.uuid(),
			asksResolution: z.boolean(),
		}),
	),
	projects: z.array(projectUseSchema),
});

const problemSchema = z.object({
	code: z.enum([
		"no_initial_status",
		"unreachable_status",
		"duplicate_transition",
		"removed_status_in_use",
		"invalid_mapping",
		"unknown_status",
	]),
	message: z.string(),
	statusId: z.string().optional(),
	statusName: z.string().optional(),
	issueCount: z.number().int().optional(),
});

const nameSchema = z.string().trim().min(1).max(255);
const descriptionSchema = z.string().trim().max(2000);

const neededSchema = z.object({
	issueTypeId: z.uuid(),
	issueTypeName: z.string(),
	statusId: z.uuid(),
	statusName: z.string(),
	issueCount: z.number().int(),
	candidates: z.array(statusSchema),
});
type Needed = z.infer<typeof neededSchema>;

function isUniqueViolation(error: unknown): boolean {
	const code = (error as { code?: string; cause?: { code?: string } } | null)
		?.code;
	const causeCode = (error as { cause?: { code?: string } } | null)?.cause
		?.code;
	return code === "23505" || causeCode === "23505";
}

async function lockName(executor: Pick<typeof db, "execute">, name: string) {
	await executor.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(lower(${name}), 0))`,
	);
}

async function nameTaken(
	name: string,
	exceptId?: string,
	executor: Executor = db,
): Promise<boolean> {
	const rows = await executor
		.select({ id: workflows.id })
		.from(workflows)
		.where(
			and(
				sql`lower(${workflows.name}) = lower(${name})`,
				exceptId ? ne(workflows.id, exceptId) : undefined,
			),
		)
		.limit(1);
	return rows.length > 0;
}

async function liveDefinition(
	workflowId: string,
	executor: Executor = db,
): Promise<Definition> {
	const statusRows = await executor
		.select({ statusId: workflowStatuses.statusId })
		.from(workflowStatuses)
		.where(eq(workflowStatuses.workflowId, workflowId));
	const transitions = await executor
		.select({
			id: workflowTransitions.id,
			name: workflowTransitions.name,
			fromStatusId: workflowTransitions.fromStatusId,
			toStatusId: workflowTransitions.toStatusId,
			asksResolution: workflowTransitions.asksResolution,
		})
		.from(workflowTransitions)
		.where(eq(workflowTransitions.workflowId, workflowId))
		.orderBy(workflowTransitions.sequence, workflowTransitions.name);
	const initial = await initialStatusFor(workflowId, executor);
	return {
		initialStatusId: initial?.id ?? null,
		statuses: statusRows.map((row) => row.statusId),
		transitions,
	};
}

async function loadDraft(
	workflowId: string,
	executor: Executor = db,
	lock = false,
): Promise<Definition | null> {
	const query = executor
		.select({ definition: workflowDrafts.definition })
		.from(workflowDrafts)
		.where(eq(workflowDrafts.workflowId, workflowId))
		.limit(1);
	const [row] = lock ? await query.for("update") : await query;
	if (!row) return null;
	const parsed = definitionSchema.safeParse(row.definition);
	if (!parsed.success) {
		console.error(
			`workflow draft ${workflowId} could not be parsed`,
			parsed.error,
		);
		return null;
	}
	return parsed.data;
}

async function statusMap(
	ids: string[],
	executor: Executor = db,
): Promise<Map<string, StatusRef>> {
	if (ids.length === 0) return new Map();
	const rows = await executor
		.select({
			id: statuses.id,
			name: statuses.name,
			category: statuses.category,
		})
		.from(statuses)
		.where(inArray(statuses.id, ids));
	return new Map(rows.map((row) => [row.id, row]));
}

async function issueCounts(
	workflowId: string,
	executor: Executor = db,
): Promise<Map<string, number>> {
	const rows = await executor
		.select({
			statusId: issues.statusId,
			count: sql<number>`count(*)::int`,
		})
		.from(issues)
		.where(governedBy(workflowId))
		.groupBy(issues.statusId);
	return new Map(rows.map((row) => [row.statusId, row.count]));
}

async function projectUses(
	workflowIds: string[],
): Promise<Map<string, ProjectUse[]>> {
	const result = new Map<string, ProjectUse[]>();
	if (workflowIds.length === 0) return result;
	const rows = await db
		.select({
			workflowId: projectWorkflows.workflowId,
			projectId: projects.id,
			key: projects.key,
			name: projects.name,
			issueTypeId: projectWorkflows.issueTypeId,
			issueTypeName: issueTypes.name,
		})
		.from(projectWorkflows)
		.innerJoin(projects, eq(projects.id, projectWorkflows.projectId))
		.leftJoin(issueTypes, eq(issueTypes.id, projectWorkflows.issueTypeId))
		.where(inArray(projectWorkflows.workflowId, workflowIds))
		.orderBy(asc(projects.key), asc(issueTypes.name));

	for (const row of rows) {
		const list = result.get(row.workflowId) ?? [];
		result.set(row.workflowId, list);
		let entry = list.find((item) => item.id === row.projectId);
		if (!entry) {
			entry = {
				id: row.projectId,
				key: row.key,
				name: row.name,
				issueTypes: [],
			};
			list.push(entry);
		}
		if (row.issueTypeId === null) {
			entry.issueTypes = "all";
		} else if (Array.isArray(entry.issueTypes)) {
			entry.issueTypes.push({
				id: row.issueTypeId,
				name: row.issueTypeName ?? "",
			});
		}
	}
	return result;
}

async function summaries(workflowId?: string) {
	const rows = await db
		.select({
			id: workflows.id,
			name: workflows.name,
			description: workflows.description,
			updatedAt: workflows.updatedAt,
			draftUpdatedAt: workflowDrafts.updatedAt,
			hasDraft: sql<boolean>`${workflowDrafts.workflowId} is not null`,
			statusCount: sql<number>`(select count(*) from workflow_statuses ws where ws.workflow_id = ${workflows.id})::int`,
			transitionCount: sql<number>`(select count(*) from workflow_transitions wt where wt.workflow_id = ${workflows.id})::int`,
		})
		.from(workflows)
		.leftJoin(workflowDrafts, eq(workflowDrafts.workflowId, workflows.id))
		.where(workflowId ? eq(workflows.id, workflowId) : undefined)
		.orderBy(asc(sql`lower(${workflows.name})`));
	const uses = await projectUses(rows.map((row) => row.id));
	return rows.map((row) => {
		const modified =
			row.draftUpdatedAt && row.draftUpdatedAt > row.updatedAt
				? row.draftUpdatedAt
				: row.updatedAt;
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			statusCount: row.statusCount,
			transitionCount: row.transitionCount,
			hasDraft: row.hasDraft,
			updatedAt: modified.toISOString(),
			projects: uses.get(row.id) ?? [],
		};
	});
}

async function loadDetail(
	workflowId: string,
	mode: "draft" | "live" | undefined,
) {
	const [workflow] = await db
		.select()
		.from(workflows)
		.where(eq(workflows.id, workflowId))
		.limit(1);
	if (!workflow) return null;

	const draft = await loadDraft(workflowId);
	const useDraft = mode !== "live" && draft !== null;
	const definition = useDraft
		? (draft as Definition)
		: await liveDefinition(workflowId);
	const known = await statusMap(definition.statuses);
	const existing: Definition = {
		initialStatusId:
			definition.initialStatusId && known.has(definition.initialStatusId)
				? definition.initialStatusId
				: null,
		statuses: definition.statuses.filter((id) => known.has(id)),
		transitions: definition.transitions.filter(
			(item) =>
				known.has(item.toStatusId) &&
				(item.fromStatusId === null || known.has(item.fromStatusId)),
		),
	};
	const counts = await issueCounts(workflowId);
	const names = new Map([...known].map(([id, status]) => [id, status.name]));
	const uses = await projectUses([workflowId]);

	return {
		id: workflow.id,
		name: workflow.name,
		description: workflow.description,
		hasDraft: draft !== null,
		mode: useDraft ? ("draft" as const) : ("live" as const),
		initialStatusId: existing.initialStatusId,
		statuses: orderStatuses(existing, names).map((id) => {
			const status = known.get(id) as StatusRef;
			return { ...status, issueCount: counts.get(id) ?? 0 };
		}),
		transitions: existing.transitions,
		projects: uses.get(workflowId) ?? [],
	};
}

/** Transition ids of the draft that already belong to a different workflow. */
async function foreignTransitionIds(
	workflowId: string,
	definition: Definition,
	executor: Executor = db,
) {
	const ids = definition.transitions.map((item) => item.id);
	if (ids.length === 0) return [];
	const rows = await executor
		.select({ id: workflowTransitions.id })
		.from(workflowTransitions)
		.where(
			and(
				inArray(workflowTransitions.id, ids),
				ne(workflowTransitions.workflowId, workflowId),
			),
		);
	return rows.map((row) => row.id);
}

function usedByMessage(name: string, list: ProjectUse[]) {
	const shown = list
		.slice(0, 3)
		.map((project) => project.key)
		.join(", ");
	const more = list.length > 3 ? ` and ${list.length - 3} more` : "";
	return `Workflow "${name}" is used by ${list.length} ${
		list.length === 1 ? "project" : "projects"
	} (${shown}${more}). Assign another workflow to ${
		list.length === 1 ? "it" : "them"
	} first.`;
}

type Mapping = Record<string, string>;

const createWorkflowBody = z.object({
	name: nameSchema,
	description: descriptionSchema.optional(),
	copyFromId: z.uuid().optional(),
});

const updateWorkflowBody = z
	.object({
		name: nameSchema.optional(),
		description: descriptionSchema.optional(),
	})
	.refine((body) => body.name !== undefined || body.description !== undefined, {
		message: "Nothing to update",
	});

const detailQuery = z.object({ mode: z.enum(["draft", "live"]).optional() });

const publishBody = z.object({
	statusMapping: z.record(z.uuid(), z.uuid()).optional(),
	dryRun: z.boolean().optional(),
});

const assignmentParams = z.object({
	projectKey: z.string().min(1).max(100),
});

const assignmentBody = z.object({
	defaultWorkflowId: z.uuid().nullable(),
	perType: z
		.array(z.object({ issueTypeId: z.uuid(), workflowId: z.uuid() }))
		.max(200),
	statusMapping: z.record(z.string(), z.uuid()).optional(),
	dryRun: z.boolean().optional(),
});

const publishResultSchema = z.object({
	ok: z.boolean(),
	problems: z.array(problemSchema),
	movedIssues: z.number().int(),
});

const assignmentSchema = z.object({
	project: z.object({
		id: z.uuid(),
		key: z.string(),
		name: z.string(),
	}),
	issueTypes: z.array(z.object({ id: z.uuid(), name: z.string() })),
	defaultWorkflowId: z.uuid().nullable(),
	perType: z.array(z.object({ issueTypeId: z.uuid(), workflowId: z.uuid() })),
	workflows: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

const assignmentResultSchema = z.object({
	ok: z.boolean(),
	needed: z.array(neededSchema),
	moved: z.number().int(),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowBody>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowBody>;
export type PublishWorkflowInput = z.infer<typeof publishBody>;
export type AssignmentInput = z.infer<typeof assignmentBody>;

export {
	assignmentBody,
	assignmentParams,
	assignmentResultSchema,
	assignmentSchema,
	createWorkflowBody,
	detailQuery,
	detailSchema,
	idParams,
	problemSchema,
	publishBody,
	publishResultSchema,
	statusSchema,
	summarySchema,
	updateWorkflowBody,
};

async function projectByKey(key: string) {
	const [project] = await db
		.select({ id: projects.id, key: projects.key, name: projects.name })
		.from(projects)
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	return project ?? null;
}

async function assignmentRows(projectId: string, executor: Executor = db) {
	const rows = await executor
		.select({
			issueTypeId: projectWorkflows.issueTypeId,
			workflowId: projectWorkflows.workflowId,
		})
		.from(projectWorkflows)
		.where(eq(projectWorkflows.projectId, projectId));
	return {
		defaultWorkflowId:
			rows.find((row) => row.issueTypeId === null)?.workflowId ?? null,
		perType: rows.flatMap((row) =>
			row.issueTypeId
				? [{ issueTypeId: row.issueTypeId, workflowId: row.workflowId }]
				: [],
		),
	};
}

export async function listWorkflows(_actor: CurrentUser) {
	requireAdminActor(_actor);
	return summaries();
}

export async function listWorkflowStatusOptions(_actor: CurrentUser) {
	requireAdminActor(_actor);
	return db
		.select({
			id: statuses.id,
			name: statuses.name,
			category: statuses.category,
		})
		.from(statuses)
		.orderBy(asc(sql`lower(${statuses.name})`));
}

export async function createWorkflow(
	actor: CurrentUser,
	body: CreateWorkflowInput,
) {
	requireAdminActor(actor);
	const { name, description, copyFromId } = body;

	let source: { name: string; definition: Definition } | null = null;
	if (copyFromId) {
		const [row] = await db
			.select({ name: workflows.name })
			.from(workflows)
			.where(eq(workflows.id, copyFromId))
			.limit(1);
		if (!row) throw new HttpError(404, "Workflow not found");
		source = {
			name: row.name,
			definition: await liveDefinition(copyFromId),
		};
	}

	try {
		const id = await db.transaction(async (tx) => {
			await lockName(tx, name);
			if (await nameTaken(name, undefined, tx)) {
				throw new HttpError(409, `A workflow named "${name}" already exists`);
			}
			const [created] = await tx
				.insert(workflows)
				.values({
					sourceId: null,
					name,
					description: description || null,
					initialStatusId: source?.definition.initialStatusId ?? null,
				})
				.returning({ id: workflows.id });

			if (source) {
				const { definition } = source;
				if (definition.statuses.length > 0) {
					await tx.insert(workflowStatuses).values(
						definition.statuses.map((statusId) => ({
							sourceId: localSource(),
							workflowId: created.id,
							statusId,
						})),
					);
				}
				if (definition.transitions.length > 0) {
					await tx.insert(workflowTransitions).values(
						definition.transitions.map((transition, sequence) => ({
							sourceId: localSource(),
							workflowId: created.id,
							name: transition.name,
							fromStatusId: transition.fromStatusId,
							toStatusId: transition.toStatusId,
							asksResolution: transition.asksResolution,
							sequence,
						})),
					);
				}
			}

			await audit(tx, actor, {
				action: source ? "workflow.copy" : "workflow.create",
				entityType: "workflow",
				entityId: created.id,
				summary: source
					? `Copied workflow ${source.name} to ${name}`
					: `Created workflow ${name}`,
				changes: { to: { name, description: description || null } },
			});
			return created.id;
		});
		const [summary] = await summaries(id);
		return summary;
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new HttpError(409, `A workflow named "${name}" already exists`);
		}
		throw error;
	}
}

export async function updateWorkflow(
	actor: CurrentUser,
	id: string,
	body: UpdateWorkflowInput,
) {
	requireAdminActor(actor);
	const { name, description } = body;
	const [current] = await db
		.select()
		.from(workflows)
		.where(eq(workflows.id, id))
		.limit(1);
	if (!current) throw new HttpError(404, "Workflow not found");

	const nextName = name ?? current.name;
	const nextDescription =
		description === undefined ? current.description : description || null;
	if (nextName === current.name && nextDescription === current.description) {
		const [summary] = await summaries(id);
		return summary;
	}

	try {
		await db.transaction(async (tx) => {
			if (name !== undefined) {
				await lockName(tx, nextName);
				if (await nameTaken(nextName, id, tx)) {
					throw new HttpError(
						409,
						`A workflow named "${nextName}" already exists`,
					);
				}
			}
			await tx
				.update(workflows)
				.set({
					name: nextName,
					description: nextDescription,
					updatedAt: new Date(),
				})
				.where(eq(workflows.id, id));
			const from: Record<string, unknown> = {};
			const to: Record<string, unknown> = {};
			if (nextName !== current.name) {
				from.name = current.name;
				to.name = nextName;
			}
			if (nextDescription !== current.description) {
				from.description = current.description;
				to.description = nextDescription;
			}
			await audit(tx, actor, {
				action: "workflow.update",
				entityType: "workflow",
				entityId: id,
				summary:
					nextName === current.name
						? `Updated the description of workflow ${current.name}`
						: `Renamed workflow ${current.name} to ${nextName}`,
				changes: { from, to },
			});
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new HttpError(409, `A workflow named "${nextName}" already exists`);
		}
		throw error;
	}
	const [summary] = await summaries(id);
	return summary;
}

export async function deleteWorkflow(
	actor: CurrentUser,
	id: string,
): Promise<void> {
	requireAdminActor(actor);
	const [current] = await db
		.select({ name: workflows.name })
		.from(workflows)
		.where(eq(workflows.id, id))
		.limit(1);
	if (!current) throw new HttpError(404, "Workflow not found");

	const used = (await projectUses([id])).get(id) ?? [];
	if (used.length > 0) {
		throw new HttpError(409, usedByMessage(current.name, used), {
			details: { count: used.length, canMigrate: false },
		});
	}

	await db.transaction(async (tx) => {
		await tx.delete(workflows).where(eq(workflows.id, id));
		await audit(tx, actor, {
			action: "workflow.delete",
			entityType: "workflow",
			entityId: id,
			summary: `Deleted workflow ${current.name}`,
			changes: { from: { name: current.name } },
		});
	});
}

export async function getWorkflow(
	_actor: CurrentUser,
	id: string,
	query: z.infer<typeof detailQuery>,
) {
	requireAdminActor(_actor);
	const detail = await loadDetail(id, query.mode);
	if (!detail) throw new HttpError(404, "Workflow not found");
	return detail;
}

export async function saveWorkflowDraft(
	actor: CurrentUser,
	id: string,
	definition: Definition,
) {
	requireAdminActor(actor);
	const [workflow] = await db
		.select({ id: workflows.id })
		.from(workflows)
		.where(eq(workflows.id, id))
		.limit(1);
	if (!workflow) throw new HttpError(404, "Workflow not found");

	const problem = shapeProblem(definition);
	if (problem) throw new HttpError(400, problem);

	const wanted = [
		...new Set([
			...definition.statuses,
			...(definition.initialStatusId ? [definition.initialStatusId] : []),
		]),
	];
	if ((await statusMap(wanted)).size !== wanted.length) {
		throw new HttpError(400, "Unknown status");
	}
	if ((await foreignTransitionIds(id, definition)).length > 0) {
		throw new HttpError(400, "Transition ids belong to another workflow");
	}

	const userId = actor.id;
	await db
		.insert(workflowDrafts)
		.values({
			workflowId: id,
			definition,
			updatedAt: new Date(),
			updatedBy: userId,
		})
		.onConflictDoUpdate({
			target: workflowDrafts.workflowId,
			set: { definition, updatedAt: new Date(), updatedBy: userId },
		});

	const detail = await loadDetail(id, "draft");
	if (!detail) throw new HttpError(404, "Workflow not found");
	return detail;
}

export async function discardWorkflowDraft(actor: CurrentUser, id: string) {
	requireAdminActor(actor);
	const [workflow] = await db
		.select({ name: workflows.name })
		.from(workflows)
		.where(eq(workflows.id, id))
		.limit(1);
	if (!workflow) throw new HttpError(404, "Workflow not found");

	const removed = await db.transaction(async (tx) => {
		const rows = await tx
			.delete(workflowDrafts)
			.where(eq(workflowDrafts.workflowId, id))
			.returning({ workflowId: workflowDrafts.workflowId });
		if (rows.length === 0) return false;
		await audit(tx, actor, {
			action: "workflow.draft.discard",
			entityType: "workflow",
			entityId: id,
			summary: `Discarded the draft of workflow ${workflow.name}`,
		});
		return true;
	});
	if (!removed) {
		throw new HttpError(404, "There is no draft to discard");
	}
}

export async function publishWorkflow(
	actor: CurrentUser,
	id: string,
	body: PublishWorkflowInput,
): Promise<z.infer<typeof publishResultSchema>> {
	requireAdminActor(actor);
	const { statusMapping, dryRun } = body;

	type Outcome =
		| { kind: "missing" }
		| { kind: "no-draft" }
		| { kind: "problems"; problems: Problem[] }
		| { kind: "ok"; movedIssues: number };

	const outcome = await db.transaction(async (tx): Promise<Outcome> => {
		const [workflow] = await tx
			.select()
			.from(workflows)
			.where(eq(workflows.id, id))
			.for("update");
		if (!workflow) return { kind: "missing" };

		const draft = await loadDraft(id, tx, true);
		if (!draft) return { kind: "no-draft" };
		const live = await liveDefinition(id, tx);

		const involved = [
			...new Set([
				...draft.statuses,
				...live.statuses,
				...Object.values(statusMapping ?? {}),
			]),
		];
		const known = await statusMap(involved, tx);
		const names = new Map(
			[...known].map(([statusId, status]) => [statusId, status.name]),
		);
		const problems = validateDefinition({
			definition: draft,
			names,
			liveStatusIds: new Set(live.statuses),
			issueCounts: await issueCounts(id, tx),
			statusMapping,
		});
		if ((await foreignTransitionIds(id, draft, tx)).length > 0) {
			problems.push({
				code: "unknown_status",
				message: "A transition of the draft belongs to another workflow",
			});
		}
		if (problems.length > 0) return { kind: "problems", problems };
		if (dryRun) return { kind: "ok", movedIssues: 0 };

		const keep = new Set(draft.statuses);
		const removed = live.statuses.filter((statusId) => !keep.has(statusId));
		let movedIssues = 0;
		for (const statusId of removed) {
			const target = statusMapping?.[statusId];
			if (target === undefined) continue;
			movedIssues += await moveIssues(
				tx,
				actor.id,
				and(eq(issues.statusId, statusId), governedBy(id)),
				known.get(target) as StatusRef,
			);
		}

		const liveStatuses = new Set(live.statuses);
		const added = draft.statuses.filter(
			(statusId) => !liveStatuses.has(statusId),
		);
		if (removed.length > 0) {
			await tx
				.delete(workflowStatuses)
				.where(
					and(
						eq(workflowStatuses.workflowId, id),
						inArray(workflowStatuses.statusId, removed),
					),
				);
		}
		if (added.length > 0) {
			await tx.insert(workflowStatuses).values(
				added.map((statusId) => ({
					sourceId: localSource(),
					workflowId: id,
					statusId,
				})),
			);
		}

		const liveIds = new Set(live.transitions.map((item) => item.id));
		const draftIds = new Set(draft.transitions.map((item) => item.id));
		const dropped = [...liveIds].filter((tid) => !draftIds.has(tid));
		if (dropped.length > 0) {
			await tx
				.delete(workflowTransitions)
				.where(inArray(workflowTransitions.id, dropped));
		}
		for (const [sequence, transition] of draft.transitions.entries()) {
			const values = {
				name: transition.name,
				fromStatusId: transition.fromStatusId,
				toStatusId: transition.toStatusId,
				asksResolution: transition.asksResolution,
				sequence,
			};
			if (liveIds.has(transition.id)) {
				await tx
					.update(workflowTransitions)
					.set({ ...values, updatedAt: new Date() })
					.where(eq(workflowTransitions.id, transition.id));
			} else {
				await tx.insert(workflowTransitions).values({
					id: transition.id,
					sourceId: localSource(),
					workflowId: id,
					...values,
				});
			}
		}

		await tx
			.update(workflows)
			.set({
				initialStatusId: draft.initialStatusId,
				updatedAt: new Date(),
			})
			.where(eq(workflows.id, id));
		await tx.delete(workflowDrafts).where(eq(workflowDrafts.workflowId, id));

		const changes = describeChanges(live, draft, names);
		await audit(tx, actor, {
			action: "workflow.publish",
			entityType: "workflow",
			entityId: id,
			summary: hasChanges(changes)
				? `Published workflow ${workflow.name}`
				: `Published workflow ${workflow.name} without changes`,
			changes: {
				from: {
					statuses: changes.removedStatuses,
					transitions: changes.removedTransitions,
					initialStatus: changes.initialStatus?.from ?? null,
				},
				to: {
					statuses: changes.addedStatuses,
					transitions: changes.addedTransitions,
					changedTransitions: changes.changedTransitions,
					initialStatus: changes.initialStatus?.to ?? null,
					movedIssues,
				},
			},
		});
		return { kind: "ok", movedIssues };
	});

	if (outcome.kind === "missing") {
		throw new HttpError(404, "Workflow not found");
	}
	if (outcome.kind === "no-draft") {
		throw new HttpError(400, "There is no draft to publish");
	}
	if (outcome.kind === "problems") {
		if (dryRun) {
			return { ok: false, problems: outcome.problems, movedIssues: 0 };
		}
		throw new HttpError(400, "The draft cannot be published yet", {
			details: { problems: outcome.problems },
		});
	}
	return { ok: true, problems: [], movedIssues: outcome.movedIssues };
}

export async function getWorkflowAssignment(
	_actor: CurrentUser,
	projectKey: string,
) {
	requireAdminActor(_actor);
	const project = await projectByKey(projectKey);
	if (!project) throw new HttpError(404, "Project not found");

	const [assignment, typeRows, all] = await Promise.all([
		assignmentRows(project.id),
		db
			.select({ id: issueTypes.id, name: issueTypes.name })
			.from(issueTypes)
			.where(
				sql`${issueTypes.id} in (select issue_type_id from project_issue_types where project_id = ${project.id})
				or ${issueTypes.id} in (select issue_type_id from project_workflows where project_id = ${project.id} and issue_type_id is not null)`,
			)
			.orderBy(asc(issueTypes.name)),
		db
			.select({ id: workflows.id, name: workflows.name })
			.from(workflows)
			.orderBy(asc(sql`lower(${workflows.name})`)),
	]);
	return { project, issueTypes: typeRows, ...assignment, workflows: all };
}

export async function setWorkflowAssignment(
	actor: CurrentUser,
	projectKey: string,
	body: AssignmentInput,
): Promise<z.infer<typeof assignmentResultSchema>> {
	requireAdminActor(actor);
	const project = await projectByKey(projectKey);
	if (!project) throw new HttpError(404, "Project not found");
	const { defaultWorkflowId, perType, dryRun } = body;
	const mapping: Mapping = body.statusMapping ?? {};

	if (new Set(perType.map((row) => row.issueTypeId)).size !== perType.length) {
		throw new HttpError(400, "An issue type is listed more than once");
	}
	const workflowIds = [
		...new Set([
			...(defaultWorkflowId ? [defaultWorkflowId] : []),
			...perType.map((row) => row.workflowId),
		]),
	];
	const known = workflowIds.length
		? await db
				.select({ id: workflows.id, name: workflows.name })
				.from(workflows)
				.where(inArray(workflows.id, workflowIds))
		: [];
	if (known.length !== workflowIds.length) {
		throw new HttpError(400, "Unknown workflow");
	}
	const typeIds = perType.map((row) => row.issueTypeId);
	const knownTypes = typeIds.length
		? await db
				.select({ id: issueTypes.id, name: issueTypes.name })
				.from(issueTypes)
				.where(inArray(issueTypes.id, typeIds))
		: [];
	if (knownTypes.length !== typeIds.length) {
		throw new HttpError(400, "Unknown issue type");
	}

	const effective = (typeId: string) =>
		perType.find((row) => row.issueTypeId === typeId)?.workflowId ??
		defaultWorkflowId;

	type AssignmentOutcome =
		| { kind: "dry-run"; needed: Needed[] }
		| { kind: "moved"; moved: number };

	const outcome = await db.transaction(
		async (tx): Promise<AssignmentOutcome> => {
			const [locked] = await tx
				.select({ id: projects.id, key: projects.key })
				.from(projects)
				.where(eq(projects.id, project.id))
				.for("update");
			if (!locked) throw new HttpError(404, "Project not found");

			const rows = await tx
				.select({
					typeId: issues.typeId,
					typeName: issueTypes.name,
					statusId: issues.statusId,
					statusName: statuses.name,
					count: sql<number>`count(*)::int`,
				})
				.from(issues)
				.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
				.innerJoin(statuses, eq(statuses.id, issues.statusId))
				.where(eq(issues.projectId, project.id))
				.groupBy(
					issues.typeId,
					issueTypes.name,
					issues.statusId,
					statuses.name,
				);

			const involvedWorkflows = [
				...new Set(
					rows
						.map((row) => effective(row.typeId))
						.filter((workflowId): workflowId is string => Boolean(workflowId)),
				),
			];
			if (involvedWorkflows.length > 0) {
				await tx
					.select({ id: workflows.id })
					.from(workflows)
					.where(inArray(workflows.id, involvedWorkflows))
					.orderBy(asc(workflows.id))
					.for("update");
			}
			const statusesOf = new Map<string, StatusRef[]>();
			if (involvedWorkflows.length > 0) {
				const statusRows = await tx
					.select({
						workflowId: workflowStatuses.workflowId,
						id: statuses.id,
						name: statuses.name,
						category: statuses.category,
					})
					.from(workflowStatuses)
					.innerJoin(statuses, eq(statuses.id, workflowStatuses.statusId))
					.where(inArray(workflowStatuses.workflowId, involvedWorkflows))
					.orderBy(asc(statuses.name));
				for (const workflowId of involvedWorkflows) {
					statusesOf.set(workflowId, []);
				}
				for (const row of statusRows) {
					statusesOf.get(row.workflowId)?.push({
						id: row.id,
						name: row.name,
						category: row.category,
					});
				}
			}

			const needed: Needed[] = [];
			const targets = new Map<string, StatusRef>();
			for (const row of rows) {
				const workflowId = effective(row.typeId);
				if (!workflowId) continue;
				const candidates = statusesOf.get(workflowId) ?? [];
				if (candidates.some((status) => status.id === row.statusId)) continue;
				const key = `${row.typeId}:${row.statusId}`;
				const chosen = mapping[key];
				const target = chosen
					? candidates.find((status) => status.id === chosen)
					: undefined;
				if (chosen && !target) {
					throw new HttpError(
						400,
						`${row.statusName} of ${row.typeName} cannot be moved to a status the new workflow does not have`,
					);
				}
				if (target) targets.set(key, target);
				needed.push({
					issueTypeId: row.typeId,
					issueTypeName: row.typeName,
					statusId: row.statusId,
					statusName: row.statusName,
					issueCount: row.count,
					candidates,
				});
			}

			const unmapped = needed.filter(
				(item) => !targets.has(`${item.issueTypeId}:${item.statusId}`),
			);
			if (dryRun) return { kind: "dry-run", needed };
			if (unmapped.length > 0) {
				throw new HttpError(
					409,
					"Some issues are in statuses the new workflow does not have. Choose where to move them.",
					{ details: { needed: unmapped } },
				);
			}

			const before = await assignmentRows(project.id, tx);
			const names = new Map(
				(
					await tx
						.select({ id: workflows.id, name: workflows.name })
						.from(workflows)
				).map((row) => [row.id, row.name]),
			);
			const typeNames = new Map(
				(
					await tx
						.select({ id: issueTypes.id, name: issueTypes.name })
						.from(issueTypes)
				).map((row) => [row.id, row.name]),
			);
			const labelAssignment = (assignment: {
				defaultWorkflowId: string | null;
				perType: { issueTypeId: string; workflowId: string }[];
			}) => ({
				default: assignment.defaultWorkflowId
					? (names.get(assignment.defaultWorkflowId) ?? null)
					: null,
				...Object.fromEntries(
					assignment.perType.map((row) => [
						typeNames.get(row.issueTypeId) ?? row.issueTypeId,
						names.get(row.workflowId) ?? row.workflowId,
					]),
				),
			});
			const from = labelAssignment(before);
			const to = labelAssignment({ defaultWorkflowId, perType });

			await tx
				.delete(projectWorkflows)
				.where(eq(projectWorkflows.projectId, project.id));
			const values = [
				...(defaultWorkflowId
					? [{ issueTypeId: null, workflowId: defaultWorkflowId }]
					: []),
				...perType,
			];
			if (values.length > 0) {
				await tx.insert(projectWorkflows).values(
					values.map((row) => ({
						sourceId: localSource(),
						projectId: project.id,
						issueTypeId: row.issueTypeId,
						workflowId: row.workflowId,
					})),
				);
			}

			let count = 0;
			for (const item of needed) {
				count += await moveIssues(
					tx,
					actor.id,
					and(
						eq(issues.projectId, project.id),
						eq(issues.typeId, item.issueTypeId),
						eq(issues.statusId, item.statusId),
					),
					targets.get(`${item.issueTypeId}:${item.statusId}`) as StatusRef,
				);
			}

			await audit(tx, actor, {
				action: "workflow.assign",
				entityType: "project",
				entityId: project.id,
				summary:
					count > 0
						? `Changed the workflows of project ${project.key} and moved ${count} ${count === 1 ? "issue" : "issues"}`
						: `Changed the workflows of project ${project.key}`,
				changes: { from, to },
			});
			return { kind: "moved", moved: count };
		},
	);

	if (outcome.kind === "dry-run") {
		return { ok: true, needed: outcome.needed, moved: 0 };
	}
	return { ok: true, needed: [], moved: outcome.moved };
}
