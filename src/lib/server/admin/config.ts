import { randomUUID } from "node:crypto";
import { and, asc, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { statusCategorySchema } from "../api-schemas.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { requireAdminActor } from "../permissions.ts";
import {
	issueHistory,
	issueHistoryItems,
	issueLinks,
	issues,
	issueTypes,
	linkTypes,
	priorities,
	projectIssueTypes,
	resolutions,
	statuses,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "../schema.ts";
import { audit } from "./audit.ts";

/** Keys `IssueTypeIcon` draws; `issue_types.icon_url` stores `builtin:<key>`. */
export const builtinIconKeys = [
	"epic",
	"subtask",
	"bug",
	"story",
	"change",
	"task",
	"default",
] as const;

export const idParams = z.object({ id: z.uuid() });
export const migrateQuery = z.object({ migrateTo: z.uuid().optional() });
export const orderBody = z.object({ ids: z.array(z.uuid()).max(2000) });

const nameBody = z
	.string()
	.trim()
	.min(1, "Name is required")
	.max(255, "Name must be 255 characters or fewer");
const descriptionBody = z.string().trim().max(10_000).nullable().optional();
const colourBody = z
	.string()
	.trim()
	.regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #FF991F")
	.nullable();
const iconBody = z
	.string()
	.trim()
	.max(255)
	.nullable()
	.optional()
	.refine(
		(value) =>
			value === null ||
			value === undefined ||
			/^builtin:(epic|subtask|bug|story|change|task|default)$/.test(value),
		"Choose one of the built-in icons",
	);
const sequenceBody = z.number().int().min(0).max(1_000_000).optional();

export const issueTypeCreateBody = z.object({
	name: nameBody,
	description: descriptionBody,
	subtask: z.boolean().optional(),
	icon: iconBody,
});
export const issueTypeUpdateBody = z.object({
	name: nameBody.optional(),
	description: descriptionBody,
	subtask: z.boolean().optional(),
	icon: iconBody,
});
export const priorityCreateBody = z.object({
	name: nameBody,
	iconColor: colourBody.optional(),
	sequence: sequenceBody,
});
export const priorityUpdateBody = z.object({
	name: nameBody.optional(),
	iconColor: colourBody.optional(),
	sequence: sequenceBody,
});
export const resolutionCreateBody = z.object({
	name: nameBody,
	description: descriptionBody,
	sequence: sequenceBody,
});
export const resolutionUpdateBody = z.object({
	name: nameBody.optional(),
	description: descriptionBody,
	sequence: sequenceBody,
});
export const statusCreateBody = z.object({
	name: nameBody,
	category: statusCategorySchema,
});
export const statusUpdateBody = z.object({
	name: nameBody.optional(),
	category: statusCategorySchema.optional(),
});
export const linkTypeCreateBody = z.object({
	name: nameBody,
	inward: nameBody,
	outward: nameBody,
});
export const linkTypeUpdateBody = z.object({
	name: nameBody.optional(),
	inward: nameBody.optional(),
	outward: nameBody.optional(),
});

const workflowRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const issueTypeRowSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	subtask: z.boolean(),
	iconUrl: z.string().nullable(),
	issueCount: z.number().int(),
	projectCount: z.number().int(),
});

export const priorityRowSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	iconColor: z.string().nullable(),
	sequence: z.number().int(),
	issueCount: z.number().int(),
});

export const resolutionRowSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	sequence: z.number().int(),
	issueCount: z.number().int(),
});

export const statusRowSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	category: statusCategorySchema,
	issueCount: z.number().int(),
	workflows: z.array(workflowRefSchema),
});

export const linkTypeRowSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	inward: z.string(),
	outward: z.string(),
	linkCount: z.number().int(),
});

export const referencesSchema = z.object({
	count: z.number().int(),
	canMigrate: z.boolean(),
	workflows: z.array(workflowRefSchema).optional(),
	projectCount: z.number().int().optional(),
});

export const conflictSchema = z.object({
	error: z.string(),
	count: z.number().int().optional(),
	canMigrate: z.boolean().optional(),
	workflows: z.array(workflowRefSchema).optional(),
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type HistoryItem = {
	field: string;
	fieldType: string;
	fromValue: string | null;
	fromText: string | null;
	toValue: string | null;
	toText: string | null;
};

const localSource = () => `local:${randomUUID()}`;

/** The entry a manual field change would leave behind, one row per issue. */
async function writeHistory(
	tx: Tx,
	issueIds: string[],
	authorId: string,
	item: HistoryItem,
) {
	if (issueIds.length === 0) return;
	const entries = await tx
		.insert(issueHistory)
		.values(
			issueIds.map((issueId) => ({
				sourceId: localSource(),
				issueId,
				authorId,
				created: new Date(),
			})),
		)
		.returning({ id: issueHistory.id });
	await tx.insert(issueHistoryItems).values(
		entries.map((entry) => ({
			sourceId: null,
			historyId: entry.id,
			field: item.field,
			fieldType: item.fieldType,
			fromValue: item.fromValue,
			fromText: item.fromText,
			toValue: item.toValue,
			toText: item.toText,
			sequence: 0,
		})),
	);
}

const changed = (from: Record<string, unknown>, to: Record<string, unknown>) =>
	Object.keys(to).length > 0 ? { from, to } : null;

const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

export async function listIssueTypes(_actor: CurrentUser) {
	requireAdminActor(_actor);
	const rows = await db
		.select()
		.from(issueTypes)
		.orderBy(asc(issueTypes.subtask), sql`lower(${issueTypes.name})`);
	const issueCounts = await db
		.select({
			id: issues.typeId,
			count: sql<number>`count(*)::int`,
		})
		.from(issues)
		.groupBy(issues.typeId);
	const projectCounts = await db
		.select({
			id: projectIssueTypes.issueTypeId,
			count: sql<number>`count(distinct ${projectIssueTypes.projectId})::int`,
		})
		.from(projectIssueTypes)
		.groupBy(projectIssueTypes.issueTypeId);

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		description: row.description,
		subtask: row.subtask,
		iconUrl: row.iconUrl,
		issueCount: issueCounts.find((entry) => entry.id === row.id)?.count ?? 0,
		projectCount:
			projectCounts.find((entry) => entry.id === row.id)?.count ?? 0,
	}));
}

export async function getIssueTypeReferences(_actor: CurrentUser, id: string) {
	requireAdminActor(_actor);
	const [row] = await db
		.select({ id: issueTypes.id })
		.from(issueTypes)
		.where(eq(issueTypes.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Issue type not found");

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.typeId, row.id));
	const [projects] = await db
		.select({
			count: sql<number>`count(distinct ${projectIssueTypes.projectId})::int`,
		})
		.from(projectIssueTypes)
		.where(eq(projectIssueTypes.issueTypeId, row.id));

	return {
		count: counts?.count ?? 0,
		projectCount: projects?.count ?? 0,
		canMigrate: true,
	};
}

export async function createIssueType(
	actor: CurrentUser,
	body: z.infer<typeof issueTypeCreateBody>,
) {
	requireAdminActor(actor);
	const [clash] = await db
		.select({ id: issueTypes.id })
		.from(issueTypes)
		.where(sql`lower(${issueTypes.name}) = lower(${body.name})`)
		.limit(1);
	if (clash) {
		throw new HttpError(
			409,
			`An issue type named "${body.name}" already exists`,
		);
	}

	const row = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(issueTypes)
			.values({
				sourceId: localSource(),
				name: body.name,
				description: body.description ?? null,
				subtask: body.subtask ?? false,
				iconUrl: body.icon ?? null,
			})
			.returning();
		await audit(tx, actor, {
			action: "issuetype.create",
			entityType: "issuetype",
			entityId: created.id,
			summary: `Created issue type ${created.name}`,
			changes: {
				from: null,
				to: {
					name: created.name,
					description: created.description,
					subtask: created.subtask,
					icon: created.iconUrl,
				},
			},
		});
		return created;
	});

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		subtask: row.subtask,
		iconUrl: row.iconUrl,
		issueCount: 0,
		projectCount: 0,
	};
}

export async function updateIssueType(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof issueTypeUpdateBody>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(issueTypes)
		.where(eq(issueTypes.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Issue type not found");

	if (body.name !== undefined && body.name !== row.name) {
		const [clash] = await db
			.select({ id: issueTypes.id })
			.from(issueTypes)
			.where(
				and(
					sql`lower(${issueTypes.name}) = lower(${body.name})`,
					ne(issueTypes.id, row.id),
				),
			)
			.limit(1);
		if (clash) {
			throw new HttpError(
				409,
				`An issue type named "${body.name}" already exists`,
			);
		}
	}

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.typeId, row.id));
	const issueCount = counts?.count ?? 0;

	if (
		body.subtask !== undefined &&
		body.subtask !== row.subtask &&
		issueCount > 0
	) {
		throw new HttpError(
			409,
			`${plural(issueCount, "issue uses", "issues use")} the issue type "${row.name}", so it cannot become ${body.subtask ? "a sub-task" : "a standard"} issue type`,
			{ details: { count: issueCount } },
		);
	}

	const updates: Partial<typeof issueTypes.$inferInsert> = {};
	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	const set = (key: string, next: unknown, previous: unknown) => {
		from[key] = previous;
		to[key] = next;
	};
	if (body.name !== undefined && body.name !== row.name) {
		updates.name = body.name;
		set("name", body.name, row.name);
	}
	if (body.description !== undefined && body.description !== row.description) {
		updates.description = body.description;
		set("description", body.description, row.description);
	}
	if (body.subtask !== undefined && body.subtask !== row.subtask) {
		updates.subtask = body.subtask;
		set("subtask", body.subtask, row.subtask);
	}
	if (body.icon !== undefined && body.icon !== row.iconUrl) {
		updates.iconUrl = body.icon;
		set("icon", body.icon, row.iconUrl);
	}

	if (Object.keys(to).length > 0) {
		updates.updatedAt = new Date();
		await db.transaction(async (tx) => {
			await tx.update(issueTypes).set(updates).where(eq(issueTypes.id, row.id));
			await audit(tx, actor, {
				action: "issuetype.update",
				entityType: "issuetype",
				entityId: row.id,
				summary: `Updated issue type ${body.name ?? row.name}`,
				changes: changed(from, to),
			});
		});
	}

	const updated = await db
		.select()
		.from(issueTypes)
		.where(eq(issueTypes.id, row.id))
		.limit(1);
	const [projects] = await db
		.select({
			count: sql<number>`count(distinct ${projectIssueTypes.projectId})::int`,
		})
		.from(projectIssueTypes)
		.where(eq(projectIssueTypes.issueTypeId, row.id));

	return {
		id: updated[0].id,
		name: updated[0].name,
		description: updated[0].description,
		subtask: updated[0].subtask,
		iconUrl: updated[0].iconUrl,
		issueCount,
		projectCount: projects?.count ?? 0,
	};
}

export async function deleteIssueType(
	actor: CurrentUser,
	id: string,
	query: z.infer<typeof migrateQuery>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(issueTypes)
		.where(eq(issueTypes.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Issue type not found");

	const migrateTo = query.migrateTo;
	if (migrateTo === row.id) {
		throw new HttpError(400, "Choose a different issue type to migrate to");
	}

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.typeId, row.id));
	const count = counts?.count ?? 0;

	let target: typeof row | null = null;
	if (migrateTo) {
		const [candidate] = await db
			.select()
			.from(issueTypes)
			.where(eq(issueTypes.id, migrateTo))
			.limit(1);
		if (!candidate) {
			throw new HttpError(400, "The issue type to migrate to does not exist");
		}
		if (candidate.subtask !== row.subtask) {
			throw new HttpError(
				400,
				`"${candidate.name}" is ${candidate.subtask ? "a sub-task" : "a standard"} issue type, so the issues cannot move to it`,
			);
		}
		target = candidate;
	}

	if (count > 0 && !target) {
		throw new HttpError(
			409,
			`${plural(count, "issue uses", "issues use")} the issue type "${row.name}"`,
			{ details: { count, canMigrate: true } },
		);
	}

	await db.transaction(async (tx) => {
		if (target && count > 0) {
			const affected = await tx
				.select({ id: issues.id, projectId: issues.projectId })
				.from(issues)
				.where(eq(issues.typeId, row.id));
			await tx
				.update(issues)
				.set({ typeId: target.id, updated: new Date() })
				.where(eq(issues.typeId, row.id));
			await writeHistory(
				tx,
				affected.map((issue) => issue.id),
				actor.id,
				{
					field: "issuetype",
					fieldType: "jira",
					fromValue: row.id,
					fromText: row.name,
					toValue: target.id,
					toText: target.name,
				},
			);
			const projectIds = [...new Set(affected.map((issue) => issue.projectId))];
			if (projectIds.length > 0) {
				await tx
					.insert(projectIssueTypes)
					.values(
						projectIds.map((projectId) => ({
							sourceId: localSource(),
							projectId,
							issueTypeId: target.id,
						})),
					)
					.onConflictDoNothing();
			}
		}
		await tx.delete(issueTypes).where(eq(issueTypes.id, row.id));
		await audit(tx, actor, {
			action: target ? "issuetype.migrate" : "issuetype.delete",
			entityType: "issuetype",
			entityId: row.id,
			summary: target
				? `Deleted issue type ${row.name} and moved ${plural(count, "issue")} to ${target.name}`
				: `Deleted issue type ${row.name}`,
			changes: {
				from: { name: row.name, subtask: row.subtask },
				to: target ? { name: target.name, movedIssues: count } : null,
			},
		});
	});
}

export async function listPriorities(_actor: CurrentUser) {
	requireAdminActor(_actor);
	const rows = await db
		.select()
		.from(priorities)
		.orderBy(asc(priorities.sequence), sql`lower(${priorities.name})`);
	const counts = await db
		.select({ id: issues.priorityId, count: sql<number>`count(*)::int` })
		.from(issues)
		.groupBy(issues.priorityId);

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		iconColor: row.iconColor,
		sequence: row.sequence,
		issueCount: counts.find((entry) => entry.id === row.id)?.count ?? 0,
	}));
}

export async function getPriorityReferences(_actor: CurrentUser, id: string) {
	requireAdminActor(_actor);
	const [row] = await db
		.select({ id: priorities.id })
		.from(priorities)
		.where(eq(priorities.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Priority not found");

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.priorityId, row.id));
	return { count: counts?.count ?? 0, canMigrate: true };
}

export async function createPriority(
	actor: CurrentUser,
	body: z.infer<typeof priorityCreateBody>,
) {
	requireAdminActor(actor);
	const [clash] = await db
		.select({ id: priorities.id })
		.from(priorities)
		.where(sql`lower(${priorities.name}) = lower(${body.name})`)
		.limit(1);
	if (clash) {
		throw new HttpError(409, `A priority named "${body.name}" already exists`);
	}

	const [highest] = await db
		.select({
			value: sql<number>`coalesce(max(${priorities.sequence}), 0)::int`,
		})
		.from(priorities);

	const row = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(priorities)
			.values({
				sourceId: localSource(),
				name: body.name,
				iconColor: body.iconColor ?? null,
				sequence: body.sequence ?? (highest?.value ?? 0) + 1,
			})
			.returning();
		await audit(tx, actor, {
			action: "priority.create",
			entityType: "priority",
			entityId: created.id,
			summary: `Created priority ${created.name}`,
			changes: {
				from: null,
				to: {
					name: created.name,
					iconColor: created.iconColor,
					sequence: created.sequence,
				},
			},
		});
		return created;
	});

	return {
		id: row.id,
		name: row.name,
		iconColor: row.iconColor,
		sequence: row.sequence,
		issueCount: 0,
	};
}

export async function updatePriority(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof priorityUpdateBody>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(priorities)
		.where(eq(priorities.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Priority not found");

	if (body.name !== undefined && body.name !== row.name) {
		const [clash] = await db
			.select({ id: priorities.id })
			.from(priorities)
			.where(
				and(
					sql`lower(${priorities.name}) = lower(${body.name})`,
					ne(priorities.id, row.id),
				),
			)
			.limit(1);
		if (clash) {
			throw new HttpError(
				409,
				`A priority named "${body.name}" already exists`,
			);
		}
	}

	const updates: Partial<typeof priorities.$inferInsert> = {};
	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	if (body.name !== undefined && body.name !== row.name) {
		updates.name = body.name;
		from.name = row.name;
		to.name = body.name;
	}
	if (body.iconColor !== undefined && body.iconColor !== row.iconColor) {
		updates.iconColor = body.iconColor;
		from.iconColor = row.iconColor;
		to.iconColor = body.iconColor;
	}
	if (body.sequence !== undefined && body.sequence !== row.sequence) {
		updates.sequence = body.sequence;
		from.sequence = row.sequence;
		to.sequence = body.sequence;
	}

	if (Object.keys(to).length > 0) {
		updates.updatedAt = new Date();
		await db.transaction(async (tx) => {
			await tx.update(priorities).set(updates).where(eq(priorities.id, row.id));
			await audit(tx, actor, {
				action: "priority.update",
				entityType: "priority",
				entityId: row.id,
				summary: `Updated priority ${body.name ?? row.name}`,
				changes: changed(from, to),
			});
		});
	}

	const [updated] = await db
		.select()
		.from(priorities)
		.where(eq(priorities.id, row.id))
		.limit(1);
	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.priorityId, row.id));

	return {
		id: updated.id,
		name: updated.name,
		iconColor: updated.iconColor,
		sequence: updated.sequence,
		issueCount: counts?.count ?? 0,
	};
}

export async function deletePriority(
	actor: CurrentUser,
	id: string,
	query: z.infer<typeof migrateQuery>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(priorities)
		.where(eq(priorities.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Priority not found");

	const migrateTo = query.migrateTo;
	if (migrateTo === row.id) {
		throw new HttpError(400, "Choose a different priority to migrate to");
	}

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.priorityId, row.id));
	const count = counts?.count ?? 0;

	let target: typeof row | null = null;
	if (migrateTo) {
		const [candidate] = await db
			.select()
			.from(priorities)
			.where(eq(priorities.id, migrateTo))
			.limit(1);
		if (!candidate) {
			throw new HttpError(400, "The priority to migrate to does not exist");
		}
		target = candidate;
	}

	if (count > 0 && !target) {
		throw new HttpError(
			409,
			`${plural(count, "issue uses", "issues use")} the priority "${row.name}"`,
			{ details: { count, canMigrate: true } },
		);
	}

	await db.transaction(async (tx) => {
		if (target && count > 0) {
			const affected = await tx
				.select({ id: issues.id })
				.from(issues)
				.where(eq(issues.priorityId, row.id));
			await tx
				.update(issues)
				.set({ priorityId: target.id, updated: new Date() })
				.where(eq(issues.priorityId, row.id));
			await writeHistory(
				tx,
				affected.map((issue) => issue.id),
				actor.id,
				{
					field: "priority",
					fieldType: "jira",
					fromValue: row.id,
					fromText: row.name,
					toValue: target.id,
					toText: target.name,
				},
			);
		}
		await tx.delete(priorities).where(eq(priorities.id, row.id));
		await audit(tx, actor, {
			action: target ? "priority.migrate" : "priority.delete",
			entityType: "priority",
			entityId: row.id,
			summary: target
				? `Deleted priority ${row.name} and moved ${plural(count, "issue")} to ${target.name}`
				: `Deleted priority ${row.name}`,
			changes: {
				from: { name: row.name, iconColor: row.iconColor },
				to: target ? { name: target.name, movedIssues: count } : null,
			},
		});
	});
}

export async function reorderPriorities(
	actor: CurrentUser,
	body: z.infer<typeof orderBody>,
) {
	requireAdminActor(actor);
	const ids = body.ids;

	const rows = await db
		.select({ id: priorities.id, name: priorities.name })
		.from(priorities);
	const known = new Set(rows.map((row) => row.id));
	if (
		ids.length !== rows.length ||
		new Set(ids).size !== ids.length ||
		ids.some((id) => !known.has(id))
	) {
		throw new HttpError(
			400,
			"The list must contain every priority exactly once",
		);
	}

	const nameOf = (id: string) => rows.find((row) => row.id === id)?.name ?? id;
	await db.transaction(async (tx) => {
		for (const [index, id] of ids.entries()) {
			await tx
				.update(priorities)
				.set({ sequence: index + 1, updatedAt: new Date() })
				.where(eq(priorities.id, id));
		}
		await audit(tx, actor, {
			action: "priority.reorder",
			entityType: "priority",
			summary: `Reordered priorities: ${ids.map(nameOf).join(", ")}`,
			changes: {
				from: { order: rows.map((row) => row.name) },
				to: { order: ids.map(nameOf) },
			},
		});
	});
}

export async function listResolutions(_actor: CurrentUser) {
	requireAdminActor(_actor);
	const rows = await db
		.select()
		.from(resolutions)
		.orderBy(asc(resolutions.sequence), sql`lower(${resolutions.name})`);
	const counts = await db
		.select({ id: issues.resolutionId, count: sql<number>`count(*)::int` })
		.from(issues)
		.groupBy(issues.resolutionId);

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		description: row.description,
		sequence: row.sequence,
		issueCount: counts.find((entry) => entry.id === row.id)?.count ?? 0,
	}));
}

export async function getResolutionReferences(_actor: CurrentUser, id: string) {
	requireAdminActor(_actor);
	const [row] = await db
		.select({ id: resolutions.id })
		.from(resolutions)
		.where(eq(resolutions.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Resolution not found");

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.resolutionId, row.id));
	return { count: counts?.count ?? 0, canMigrate: true };
}

export async function createResolution(
	actor: CurrentUser,
	body: z.infer<typeof resolutionCreateBody>,
) {
	requireAdminActor(actor);
	const [clash] = await db
		.select({ id: resolutions.id })
		.from(resolutions)
		.where(sql`lower(${resolutions.name}) = lower(${body.name})`)
		.limit(1);
	if (clash) {
		throw new HttpError(
			409,
			`A resolution named "${body.name}" already exists`,
		);
	}

	const [highest] = await db
		.select({
			value: sql<number>`coalesce(max(${resolutions.sequence}), 0)::int`,
		})
		.from(resolutions);

	const row = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(resolutions)
			.values({
				sourceId: localSource(),
				name: body.name,
				description: body.description ?? null,
				sequence: body.sequence ?? (highest?.value ?? 0) + 1,
			})
			.returning();
		await audit(tx, actor, {
			action: "resolution.create",
			entityType: "resolution",
			entityId: created.id,
			summary: `Created resolution ${created.name}`,
			changes: {
				from: null,
				to: {
					name: created.name,
					description: created.description,
					sequence: created.sequence,
				},
			},
		});
		return created;
	});

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		sequence: row.sequence,
		issueCount: 0,
	};
}

export async function updateResolution(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof resolutionUpdateBody>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(resolutions)
		.where(eq(resolutions.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Resolution not found");

	if (body.name !== undefined && body.name !== row.name) {
		const [clash] = await db
			.select({ id: resolutions.id })
			.from(resolutions)
			.where(
				and(
					sql`lower(${resolutions.name}) = lower(${body.name})`,
					ne(resolutions.id, row.id),
				),
			)
			.limit(1);
		if (clash) {
			throw new HttpError(
				409,
				`A resolution named "${body.name}" already exists`,
			);
		}
	}

	const updates: Partial<typeof resolutions.$inferInsert> = {};
	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	if (body.name !== undefined && body.name !== row.name) {
		updates.name = body.name;
		from.name = row.name;
		to.name = body.name;
	}
	if (body.description !== undefined && body.description !== row.description) {
		updates.description = body.description;
		from.description = row.description;
		to.description = body.description;
	}
	if (body.sequence !== undefined && body.sequence !== row.sequence) {
		updates.sequence = body.sequence;
		from.sequence = row.sequence;
		to.sequence = body.sequence;
	}

	if (Object.keys(to).length > 0) {
		updates.updatedAt = new Date();
		await db.transaction(async (tx) => {
			await tx
				.update(resolutions)
				.set(updates)
				.where(eq(resolutions.id, row.id));
			await audit(tx, actor, {
				action: "resolution.update",
				entityType: "resolution",
				entityId: row.id,
				summary: `Updated resolution ${body.name ?? row.name}`,
				changes: changed(from, to),
			});
		});
	}

	const [updated] = await db
		.select()
		.from(resolutions)
		.where(eq(resolutions.id, row.id))
		.limit(1);
	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.resolutionId, row.id));

	return {
		id: updated.id,
		name: updated.name,
		description: updated.description,
		sequence: updated.sequence,
		issueCount: counts?.count ?? 0,
	};
}

export async function deleteResolution(
	actor: CurrentUser,
	id: string,
	query: z.infer<typeof migrateQuery>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(resolutions)
		.where(eq(resolutions.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Resolution not found");

	const migrateTo = query.migrateTo;
	if (migrateTo === row.id) {
		throw new HttpError(400, "Choose a different resolution to migrate to");
	}

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.resolutionId, row.id));
	const count = counts?.count ?? 0;

	let target: typeof row | null = null;
	if (migrateTo) {
		const [candidate] = await db
			.select()
			.from(resolutions)
			.where(eq(resolutions.id, migrateTo))
			.limit(1);
		if (!candidate) {
			throw new HttpError(400, "The resolution to migrate to does not exist");
		}
		target = candidate;
	}

	if (count > 0 && !target) {
		throw new HttpError(
			409,
			`${plural(count, "issue uses", "issues use")} the resolution "${row.name}"`,
			{ details: { count, canMigrate: true } },
		);
	}

	await db.transaction(async (tx) => {
		if (target && count > 0) {
			const affected = await tx
				.select({ id: issues.id })
				.from(issues)
				.where(eq(issues.resolutionId, row.id));
			await tx
				.update(issues)
				.set({ resolutionId: target.id, updated: new Date() })
				.where(eq(issues.resolutionId, row.id));
			await writeHistory(
				tx,
				affected.map((issue) => issue.id),
				actor.id,
				{
					field: "resolution",
					fieldType: "jira",
					fromValue: row.id,
					fromText: row.name,
					toValue: target.id,
					toText: target.name,
				},
			);
		}
		await tx.delete(resolutions).where(eq(resolutions.id, row.id));
		await audit(tx, actor, {
			action: target ? "resolution.migrate" : "resolution.delete",
			entityType: "resolution",
			entityId: row.id,
			summary: target
				? `Deleted resolution ${row.name} and moved ${plural(count, "issue")} to ${target.name}`
				: `Deleted resolution ${row.name}`,
			changes: {
				from: { name: row.name },
				to: target ? { name: target.name, movedIssues: count } : null,
			},
		});
	});
}

export async function reorderResolutions(
	actor: CurrentUser,
	body: z.infer<typeof orderBody>,
) {
	requireAdminActor(actor);
	const ids = body.ids;

	const rows = await db
		.select({ id: resolutions.id, name: resolutions.name })
		.from(resolutions);
	const known = new Set(rows.map((row) => row.id));
	if (
		ids.length !== rows.length ||
		new Set(ids).size !== ids.length ||
		ids.some((id) => !known.has(id))
	) {
		throw new HttpError(
			400,
			"The list must contain every resolution exactly once",
		);
	}

	const nameOf = (id: string) => rows.find((row) => row.id === id)?.name ?? id;
	await db.transaction(async (tx) => {
		for (const [index, id] of ids.entries()) {
			await tx
				.update(resolutions)
				.set({ sequence: index + 1, updatedAt: new Date() })
				.where(eq(resolutions.id, id));
		}
		await audit(tx, actor, {
			action: "resolution.reorder",
			entityType: "resolution",
			summary: `Reordered resolutions: ${ids.map(nameOf).join(", ")}`,
			changes: {
				from: { order: rows.map((row) => row.name) },
				to: { order: ids.map(nameOf) },
			},
		});
	});
}

export async function listStatuses(_actor: CurrentUser) {
	requireAdminActor(_actor);
	const rows = await db
		.select()
		.from(statuses)
		.orderBy(sql`lower(${statuses.name})`);
	const counts = await db
		.select({ id: issues.statusId, count: sql<number>`count(*)::int` })
		.from(issues)
		.groupBy(issues.statusId);
	const users = await db
		.select({
			statusId: workflowStatuses.statusId,
			id: workflows.id,
			name: workflows.name,
		})
		.from(workflowStatuses)
		.innerJoin(workflows, eq(workflows.id, workflowStatuses.workflowId));

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		category: row.category,
		issueCount: counts.find((entry) => entry.id === row.id)?.count ?? 0,
		workflows: users
			.filter((entry) => entry.statusId === row.id)
			.map((entry) => ({ id: entry.id, name: entry.name })),
	}));
}

export async function getStatusReferences(_actor: CurrentUser, id: string) {
	requireAdminActor(_actor);
	const [row] = await db
		.select({ id: statuses.id })
		.from(statuses)
		.where(eq(statuses.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Status not found");

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.statusId, row.id));
	const usedBy = await workflowsUsingStatus(row.id);
	return {
		count: counts?.count ?? 0,
		canMigrate: usedBy.length === 0,
		workflows: usedBy,
	};
}

export async function createStatus(
	actor: CurrentUser,
	body: z.infer<typeof statusCreateBody>,
) {
	requireAdminActor(actor);
	const [clash] = await db
		.select({ id: statuses.id })
		.from(statuses)
		.where(sql`lower(${statuses.name}) = lower(${body.name})`)
		.limit(1);
	if (clash) {
		throw new HttpError(409, `A status named "${body.name}" already exists`);
	}

	const row = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(statuses)
			.values({
				sourceId: localSource(),
				name: body.name,
				category: body.category,
			})
			.returning();
		await audit(tx, actor, {
			action: "status.create",
			entityType: "status",
			entityId: created.id,
			summary: `Created status ${created.name}`,
			changes: {
				from: null,
				to: { name: created.name, category: created.category },
			},
		});
		return created;
	});

	return {
		id: row.id,
		name: row.name,
		category: row.category,
		issueCount: 0,
		workflows: [],
	};
}

export async function updateStatus(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof statusUpdateBody>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(statuses)
		.where(eq(statuses.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Status not found");

	if (body.name !== undefined && body.name !== row.name) {
		const [clash] = await db
			.select({ id: statuses.id })
			.from(statuses)
			.where(
				and(
					sql`lower(${statuses.name}) = lower(${body.name})`,
					ne(statuses.id, row.id),
				),
			)
			.limit(1);
		if (clash) {
			throw new HttpError(409, `A status named "${body.name}" already exists`);
		}
	}

	const updates: Partial<typeof statuses.$inferInsert> = {};
	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	if (body.name !== undefined && body.name !== row.name) {
		updates.name = body.name;
		from.name = row.name;
		to.name = body.name;
	}
	if (body.category !== undefined && body.category !== row.category) {
		updates.category = body.category;
		from.category = row.category;
		to.category = body.category;
	}

	if (Object.keys(to).length > 0) {
		updates.updatedAt = new Date();
		await db.transaction(async (tx) => {
			await tx.update(statuses).set(updates).where(eq(statuses.id, row.id));
			await audit(tx, actor, {
				action: "status.update",
				entityType: "status",
				entityId: row.id,
				summary: `Updated status ${body.name ?? row.name}`,
				changes: changed(from, to),
			});
		});
	}

	const [updated] = await db
		.select()
		.from(statuses)
		.where(eq(statuses.id, row.id))
		.limit(1);
	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.statusId, row.id));
	const usedBy = await workflowsUsingStatus(row.id);

	return {
		id: updated.id,
		name: updated.name,
		category: updated.category,
		issueCount: counts?.count ?? 0,
		workflows: usedBy,
	};
}

export async function deleteStatus(
	actor: CurrentUser,
	id: string,
	query: z.infer<typeof migrateQuery>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(statuses)
		.where(eq(statuses.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Status not found");

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.statusId, row.id));
	const count = counts?.count ?? 0;

	const usedBy = await workflowsUsingStatus(row.id);
	if (usedBy.length > 0) {
		throw new HttpError(
			409,
			`The status "${row.name}" is used by the ${usedBy.length === 1 ? "workflow" : "workflows"} ${usedBy.map((workflow) => `"${workflow.name}"`).join(", ")}. Remove it from ${usedBy.length === 1 ? "that workflow" : "those workflows"} first.`,
			{ details: { count, canMigrate: false, workflows: usedBy } },
		);
	}

	const migrateTo = query.migrateTo;
	if (migrateTo === row.id) {
		throw new HttpError(400, "Choose a different status to migrate to");
	}

	let target: typeof row | null = null;
	if (migrateTo) {
		const [candidate] = await db
			.select()
			.from(statuses)
			.where(eq(statuses.id, migrateTo))
			.limit(1);
		if (!candidate) {
			throw new HttpError(400, "The status to migrate to does not exist");
		}
		target = candidate;
	}

	if (count > 0 && !target) {
		throw new HttpError(
			409,
			`${plural(count, "issue uses", "issues use")} the status "${row.name}"`,
			{ details: { count, canMigrate: true } },
		);
	}

	await db.transaction(async (tx) => {
		if (target && count > 0) {
			const affected = await tx
				.select({ id: issues.id })
				.from(issues)
				.where(eq(issues.statusId, row.id));
			await tx
				.update(issues)
				.set({ statusId: target.id, updated: new Date() })
				.where(eq(issues.statusId, row.id));
			await writeHistory(
				tx,
				affected.map((issue) => issue.id),
				actor.id,
				{
					field: "status",
					fieldType: "jira",
					fromValue: row.id,
					fromText: row.name,
					toValue: target.id,
					toText: target.name,
				},
			);
		}
		await tx.delete(statuses).where(eq(statuses.id, row.id));
		await audit(tx, actor, {
			action: target ? "status.migrate" : "status.delete",
			entityType: "status",
			entityId: row.id,
			summary: target
				? `Deleted status ${row.name} and moved ${plural(count, "issue")} to ${target.name}`
				: `Deleted status ${row.name}`,
			changes: {
				from: { name: row.name, category: row.category },
				to: target ? { name: target.name, movedIssues: count } : null,
			},
		});
	});
}

export async function listLinkTypes(_actor: CurrentUser) {
	requireAdminActor(_actor);
	const rows = await db
		.select()
		.from(linkTypes)
		.orderBy(sql`lower(${linkTypes.name})`);
	const counts = await db
		.select({ id: issueLinks.typeId, count: sql<number>`count(*)::int` })
		.from(issueLinks)
		.groupBy(issueLinks.typeId);

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		inward: row.inward,
		outward: row.outward,
		linkCount: counts.find((entry) => entry.id === row.id)?.count ?? 0,
	}));
}

export async function getLinkTypeReferences(_actor: CurrentUser, id: string) {
	requireAdminActor(_actor);
	const [row] = await db
		.select({ id: linkTypes.id })
		.from(linkTypes)
		.where(eq(linkTypes.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Link type not found");

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issueLinks)
		.where(eq(issueLinks.typeId, row.id));
	return { count: counts?.count ?? 0, canMigrate: true };
}

export async function createLinkType(
	actor: CurrentUser,
	body: z.infer<typeof linkTypeCreateBody>,
) {
	requireAdminActor(actor);
	const [clash] = await db
		.select({ id: linkTypes.id })
		.from(linkTypes)
		.where(sql`lower(${linkTypes.name}) = lower(${body.name})`)
		.limit(1);
	if (clash) {
		throw new HttpError(409, `A link type named "${body.name}" already exists`);
	}

	const row = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(linkTypes)
			.values({
				sourceId: localSource(),
				name: body.name,
				inward: body.inward,
				outward: body.outward,
			})
			.returning();
		await audit(tx, actor, {
			action: "linktype.create",
			entityType: "linktype",
			entityId: created.id,
			summary: `Created link type ${created.name}`,
			changes: {
				from: null,
				to: {
					name: created.name,
					inward: created.inward,
					outward: created.outward,
				},
			},
		});
		return created;
	});

	return {
		id: row.id,
		name: row.name,
		inward: row.inward,
		outward: row.outward,
		linkCount: 0,
	};
}

export async function updateLinkType(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof linkTypeUpdateBody>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(linkTypes)
		.where(eq(linkTypes.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Link type not found");

	if (body.name !== undefined && body.name !== row.name) {
		const [clash] = await db
			.select({ id: linkTypes.id })
			.from(linkTypes)
			.where(
				and(
					sql`lower(${linkTypes.name}) = lower(${body.name})`,
					ne(linkTypes.id, row.id),
				),
			)
			.limit(1);
		if (clash) {
			throw new HttpError(
				409,
				`A link type named "${body.name}" already exists`,
			);
		}
	}

	const updates: Partial<typeof linkTypes.$inferInsert> = {};
	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	for (const key of ["name", "inward", "outward"] as const) {
		const next = body[key];
		if (next !== undefined && next !== row[key]) {
			updates[key] = next;
			from[key] = row[key];
			to[key] = next;
		}
	}

	if (Object.keys(to).length > 0) {
		updates.updatedAt = new Date();
		await db.transaction(async (tx) => {
			await tx.update(linkTypes).set(updates).where(eq(linkTypes.id, row.id));
			await audit(tx, actor, {
				action: "linktype.update",
				entityType: "linktype",
				entityId: row.id,
				summary: `Updated link type ${body.name ?? row.name}`,
				changes: changed(from, to),
			});
		});
	}

	const [updated] = await db
		.select()
		.from(linkTypes)
		.where(eq(linkTypes.id, row.id))
		.limit(1);
	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issueLinks)
		.where(eq(issueLinks.typeId, row.id));

	return {
		id: updated.id,
		name: updated.name,
		inward: updated.inward,
		outward: updated.outward,
		linkCount: counts?.count ?? 0,
	};
}

export async function deleteLinkType(
	actor: CurrentUser,
	id: string,
	query: z.infer<typeof migrateQuery>,
) {
	requireAdminActor(actor);
	const [row] = await db
		.select()
		.from(linkTypes)
		.where(eq(linkTypes.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Link type not found");

	const migrateTo = query.migrateTo;
	if (migrateTo === row.id) {
		throw new HttpError(400, "Choose a different link type to migrate to");
	}

	const [counts] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issueLinks)
		.where(eq(issueLinks.typeId, row.id));
	const count = counts?.count ?? 0;

	let target: typeof row | null = null;
	if (migrateTo) {
		const [candidate] = await db
			.select()
			.from(linkTypes)
			.where(eq(linkTypes.id, migrateTo))
			.limit(1);
		if (!candidate) {
			throw new HttpError(400, "The link type to migrate to does not exist");
		}
		target = candidate;
	}

	if (count > 0 && !target) {
		throw new HttpError(
			409,
			`${plural(count, "link uses", "links use")} the link type "${row.name}"`,
			{ details: { count, canMigrate: true } },
		);
	}

	await db.transaction(async (tx) => {
		if (target && count > 0) {
			await tx
				.update(issueLinks)
				.set({ typeId: target.id, updatedAt: new Date() })
				.where(eq(issueLinks.typeId, row.id));
		}
		await tx.delete(linkTypes).where(eq(linkTypes.id, row.id));
		await audit(tx, actor, {
			action: target ? "linktype.migrate" : "linktype.delete",
			entityType: "linktype",
			entityId: row.id,
			summary: target
				? `Deleted link type ${row.name} and moved ${plural(count, "link")} to ${target.name}`
				: `Deleted link type ${row.name}`,
			changes: {
				from: { name: row.name },
				to: target ? { name: target.name, movedLinks: count } : null,
			},
		});
	});
}

async function workflowsUsingStatus(statusId: string) {
	const listed = await db
		.select({ id: workflows.id, name: workflows.name })
		.from(workflowStatuses)
		.innerJoin(workflows, eq(workflows.id, workflowStatuses.workflowId))
		.where(eq(workflowStatuses.statusId, statusId));
	const transitioned = await db
		.select({ id: workflows.id, name: workflows.name })
		.from(workflowTransitions)
		.innerJoin(workflows, eq(workflows.id, workflowTransitions.workflowId))
		.where(
			or(
				eq(workflowTransitions.fromStatusId, statusId),
				eq(workflowTransitions.toStatusId, statusId),
			),
		);

	const byId = new Map<string, { id: string; name: string }>();
	for (const workflow of [...listed, ...transitioned]) {
		byId.set(workflow.id, workflow);
	}
	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
