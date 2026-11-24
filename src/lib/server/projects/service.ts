import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import {
	issueTypeIconSql,
	priorityIconSql,
	projectAvatarSql,
	userAvatarSql,
} from "../avatars.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { offsetQuery } from "../paging.ts";
import { can, projectPermissions, visibleProjectIds } from "../permissions.ts";
import { ARCHIVED_PROJECT_MESSAGE } from "../project-keys.ts";
import {
	components,
	issues,
	issueTypes,
	priorities,
	projectIssueTypes,
	projects,
	projectWorkflows,
	resolutions,
	statuses,
	users,
	versions,
	workflows,
} from "../schema.ts";
import { statusesForWorkflow, type WorkflowRef } from "../workflows.ts";
import { requireProjectPermission } from "./access.ts";

export const projectParams = z.object({ key: z.string().min(1).max(100) });
export const componentParams = z.object({ id: z.uuid() });
export const versionParams = z.object({ id: z.uuid() });

const descriptionBody = z.string().trim().max(10_000).nullable().optional();
const dateBody = z.iso.date().nullable().optional();

export const updateProjectBody = z.object({
	name: z.string().trim().min(1).max(255).optional(),
	description: descriptionBody,
	leadId: z.uuid().nullable().optional(),
});

export const createComponentBody = z.object({
	name: z.string().trim().min(1).max(255),
	description: descriptionBody,
	leadId: z.uuid().nullable().optional(),
});

export const updateComponentBody = z.object({
	name: z.string().trim().min(1).max(255).optional(),
	description: descriptionBody,
	leadId: z.uuid().nullable().optional(),
});

export const createVersionBody = z.object({
	name: z.string().trim().min(1).max(255),
	description: descriptionBody,
	startDate: dateBody,
	releaseDate: dateBody,
	released: z.boolean().optional(),
});

export const updateVersionBody = z.object({
	name: z.string().trim().min(1).max(255).optional(),
	description: descriptionBody,
	startDate: dateBody,
	releaseDate: dateBody,
	released: z.boolean().optional(),
	archived: z.boolean().optional(),
});

export const projectIssuesQuery = z.object({
	offset: offsetQuery,
	limit: z.coerce.number().int().min(1).max(1000).default(50),
});

function userRef(row: {
	id: string | null;
	username: string | null;
	displayName: string | null;
	avatarUrl: string | null;
}) {
	if (!row.id || !row.username || !row.displayName) return null;
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		avatarUrl: row.avatarUrl,
	};
}

const reporter = alias(users, "reporter");

async function validLead(id: string) {
	const [lead] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.id, id), eq(users.active, true)))
		.limit(1);
	return lead !== undefined;
}

async function requireWritableProject(projectId: string) {
	const [project] = await db
		.select({ archived: projects.archived })
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1);
	if (project?.archived) throw new HttpError(403, ARCHIVED_PROJECT_MESSAGE);
}

const leadColumns = {
	id: users.id,
	username: users.username,
	displayName: users.displayName,
	avatarUrl: userAvatarSql(users.id),
};

const projectColumns = {
	id: projects.id,
	key: projects.key,
	name: projects.name,
	description: projects.description,
	type: projects.projectType,
	category: projects.categoryName,
	avatarUrl: projectAvatarSql(projects.id),
	archived: projects.archived,
	issueCount: sql<number>`(
		select count(*)::int from ${issues} where ${issues.projectId} = ${projects.id}
	)`,
	leadId: users.id,
	leadUsername: users.username,
	leadDisplayName: users.displayName,
	leadAvatarUrl: userAvatarSql(users.id),
};

async function loadProject(key: string) {
	const [row] = await db
		.select(projectColumns)
		.from(projects)
		.leftJoin(users, eq(users.id, projects.leadId))
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);

	if (!row) return null;
	return {
		id: row.id,
		key: row.key,
		name: row.name,
		description: row.description,
		type: row.type,
		category: row.category,
		avatarUrl: row.avatarUrl,
		issueCount: row.issueCount,
		archived: row.archived,
		lead: userRef({
			id: row.leadId,
			username: row.leadUsername,
			displayName: row.leadDisplayName,
			avatarUrl: row.leadAvatarUrl,
		}),
	};
}

export async function listProjects(actor: CurrentUser) {
	const visible = await visibleProjectIds(actor);
	if (visible.length === 0) return [];

	const rows = await db
		.select(projectColumns)
		.from(projects)
		.leftJoin(users, eq(users.id, projects.leadId))
		.where(and(eq(projects.archived, false), inArray(projects.id, visible)))
		.orderBy(projects.name);

	return Promise.all(
		rows.map(async (row) => ({
			id: row.id,
			key: row.key,
			name: row.name,
			description: row.description,
			type: row.type,
			category: row.category,
			avatarUrl: row.avatarUrl,
			issueCount: row.issueCount,
			archived: row.archived,
			lead: userRef({
				id: row.leadId,
				username: row.leadUsername,
				displayName: row.leadDisplayName,
				avatarUrl: row.leadAvatarUrl,
			}),
			permissions: await projectPermissions(actor, {
				id: row.id,
				key: row.key,
				leadId: row.leadId,
			}),
		})),
	);
}

export async function getProject(actor: CurrentUser, key: string) {
	const project = await loadProject(key);
	if (!project) throw new HttpError(404, "Project not found");
	const permissionProject = {
		id: project.id,
		key: project.key,
		leadId: project.lead?.id ?? null,
	};
	if (!(await can(actor, "BROWSE_PROJECTS", permissionProject))) {
		throw new HttpError(404, "Project not found");
	}

	const [
		types,
		workflowRows,
		componentRows,
		versionRows,
		priorityRows,
		permissions,
	] = await Promise.all([
		db
			.select({
				id: issueTypes.id,
				name: issueTypes.name,
				subtask: issueTypes.subtask,
				iconUrl: issueTypeIconSql(
					issueTypes.id,
					issueTypes.iconFile,
					issueTypes.iconUrl,
				),
			})
			.from(projectIssueTypes)
			.innerJoin(issueTypes, eq(issueTypes.id, projectIssueTypes.issueTypeId))
			.where(eq(projectIssueTypes.projectId, project.id))
			.orderBy(issueTypes.name),
		db
			.select({
				id: workflows.id,
				name: workflows.name,
				issueTypeId: projectWorkflows.issueTypeId,
			})
			.from(projectWorkflows)
			.innerJoin(workflows, eq(workflows.id, projectWorkflows.workflowId))
			.where(eq(projectWorkflows.projectId, project.id)),
		db
			.select({
				id: components.id,
				name: components.name,
				description: components.description,
				leadId: users.id,
				leadUsername: users.username,
				leadDisplayName: users.displayName,
				leadAvatarUrl: userAvatarSql(users.id),
			})
			.from(components)
			.leftJoin(users, eq(users.id, components.leadId))
			.where(eq(components.projectId, project.id))
			.orderBy(components.name),
		db
			.select()
			.from(versions)
			.where(eq(versions.projectId, project.id))
			.orderBy(versions.sequence, versions.name),
		db.select().from(priorities).orderBy(priorities.sequence, priorities.name),
		projectPermissions(actor, permissionProject),
	]);

	const statusesByWorkflow = new Map<
		string,
		Awaited<ReturnType<typeof statusesForWorkflow>>
	>();
	await Promise.all(
		[...new Set(workflowRows.map((workflow) => workflow.id))].map(
			async (workflowId) => {
				statusesByWorkflow.set(
					workflowId,
					await statusesForWorkflow(workflowId),
				);
			},
		),
	);

	function workflowFor(issueTypeId: string): WorkflowRef | null {
		const match =
			workflowRows.find((row) => row.issueTypeId === issueTypeId) ??
			workflowRows.find((row) => row.issueTypeId === null);
		if (!match) return null;
		return { id: match.id, name: match.name };
	}

	return {
		...project,
		permissions,
		issueTypes: types.map((type) => {
			const workflow = workflowFor(type.id);
			return {
				...type,
				workflow: workflow
					? {
							id: workflow.id,
							name: workflow.name,
							statuses: statusesByWorkflow.get(workflow.id) ?? [],
						}
					: null,
			};
		}),
		components: componentRows.map((row) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			lead: userRef({
				id: row.leadId,
				username: row.leadUsername,
				displayName: row.leadDisplayName,
				avatarUrl: row.leadAvatarUrl,
			}),
		})),
		versions: versionRows.map((row) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			released: row.released,
			archived: row.archived,
			startDate: row.startDate,
			releaseDate: row.releaseDate,
		})),
		priorities: priorityRows.map((row) => ({
			id: row.id,
			name: row.name,
			iconColor: row.iconColor,
			iconUrl: row.iconFile ? `/api/avatars/priorities/${row.id}` : null,
		})),
	};
}

export async function listProjectIssues(
	actor: CurrentUser,
	key: string,
	input: { offset: number; limit: number },
) {
	const [project] = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	if (!project) throw new HttpError(404, "Project not found");
	await requireProjectPermission(actor, project.id, "BROWSE_PROJECTS");

	const { rows, total } = await db.transaction(
		async (tx) => {
			const rows = await tx
				.select({
					id: issues.id,
					key: issues.key,
					summary: issues.summary,
					created: issues.created,
					updated: issues.updated,
					typeId: issueTypes.id,
					typeName: issueTypes.name,
					typeSubtask: issueTypes.subtask,
					typeIconUrl: issueTypeIconSql(
						issueTypes.id,
						issueTypes.iconFile,
						issueTypes.iconUrl,
					),
					statusId: statuses.id,
					statusName: statuses.name,
					statusCategory: statuses.category,
					priorityId: priorities.id,
					priorityName: priorities.name,
					priorityColor: priorities.iconColor,
					priorityIconUrl: priorityIconSql(priorities.id, priorities.iconFile),
					resolutionId: resolutions.id,
					resolutionName: resolutions.name,
					assigneeId: users.id,
					assigneeUsername: users.username,
					assigneeDisplayName: users.displayName,
					assigneeAvatarUrl: userAvatarSql(users.id),
					reporterId: reporter.id,
					reporterUsername: reporter.username,
					reporterDisplayName: reporter.displayName,
					reporterAvatarUrl: userAvatarSql(reporter.id),
				})
				.from(issues)
				.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
				.innerJoin(statuses, eq(statuses.id, issues.statusId))
				.leftJoin(priorities, eq(priorities.id, issues.priorityId))
				.leftJoin(resolutions, eq(resolutions.id, issues.resolutionId))
				.leftJoin(users, eq(users.id, issues.assigneeId))
				.leftJoin(reporter, eq(reporter.id, issues.reporterId))
				.where(eq(issues.projectId, project.id))
				.orderBy(sql`${issues.created} desc nulls last`, desc(issues.number))
				.offset(input.offset)
				.limit(input.limit);

			const [count] = await tx
				.select({ total: sql<number>`count(*)::int` })
				.from(issues)
				.where(eq(issues.projectId, project.id));

			return { rows, total: count?.total ?? 0 };
		},
		{ isolationLevel: "repeatable read" },
	);

	return {
		issues: rows.map((row) => ({
			id: row.id,
			key: row.key,
			summary: row.summary,
			type: {
				id: row.typeId,
				name: row.typeName,
				subtask: row.typeSubtask,
				iconUrl: row.typeIconUrl,
			},
			status: {
				id: row.statusId,
				name: row.statusName,
				category: row.statusCategory,
			},
			priority: row.priorityId
				? {
						id: row.priorityId,
						name: row.priorityName as string,
						iconColor: row.priorityColor,
						iconUrl: row.priorityIconUrl,
					}
				: null,
			resolution: row.resolutionId
				? { id: row.resolutionId, name: row.resolutionName as string }
				: null,
			assignee: userRef({
				id: row.assigneeId,
				username: row.assigneeUsername,
				displayName: row.assigneeDisplayName,
				avatarUrl: row.assigneeAvatarUrl,
			}),
			reporter: userRef({
				id: row.reporterId,
				username: row.reporterUsername,
				displayName: row.reporterDisplayName,
				avatarUrl: row.reporterAvatarUrl,
			}),
			created: row.created?.toISOString() ?? null,
			updated: row.updated?.toISOString() ?? null,
		})),
		total,
		offset: input.offset,
		limit: input.limit,
	};
}

export async function updateProject(
	actor: CurrentUser,
	key: string,
	body: z.output<typeof updateProjectBody>,
) {
	const project = await loadProject(key);
	if (!project) throw new HttpError(404, "Project not found");
	await requireProjectPermission(actor, project.id, "ADMINISTER_PROJECTS");

	const { name, description, leadId } = body;
	if (leadId && !(await validLead(leadId))) {
		throw new HttpError(400, "Unknown project lead");
	}

	await db
		.update(projects)
		.set({
			...(name !== undefined ? { name } : {}),
			...(description !== undefined ? { description } : {}),
			...(leadId !== undefined ? { leadId } : {}),
			updatedAt: new Date(),
		})
		.where(eq(projects.id, project.id));

	const updated = await loadProject(project.key);
	if (!updated) throw new HttpError(404, "Project not found");
	return {
		...updated,
		permissions: await projectPermissions(actor, {
			id: updated.id,
			key: updated.key,
			leadId: updated.lead?.id ?? null,
		}),
	};
}

export async function createComponent(
	actor: CurrentUser,
	key: string,
	body: z.output<typeof createComponentBody>,
) {
	const project = await loadProject(key);
	if (!project) throw new HttpError(404, "Project not found");
	await requireProjectPermission(actor, project.id, "ADMINISTER_PROJECTS");
	if (body.leadId && !(await validLead(body.leadId))) {
		throw new HttpError(400, "Unknown component lead");
	}

	const [created] = await db
		.insert(components)
		.values({
			sourceId: `local:${randomUUID()}`,
			projectId: project.id,
			name: body.name,
			description: body.description ?? null,
			leadId: body.leadId ?? null,
		})
		.returning();

	const lead = created.leadId
		? (
				await db
					.select(leadColumns)
					.from(users)
					.where(eq(users.id, created.leadId))
					.limit(1)
			)[0]
		: undefined;

	return {
		id: created.id,
		name: created.name,
		description: created.description,
		lead: lead ? userRef(lead) : null,
	};
}

export async function updateComponent(
	actor: CurrentUser,
	id: string,
	body: z.output<typeof updateComponentBody>,
	expectedProjectId?: string,
) {
	const [existing] = await db
		.select({ projectId: components.projectId })
		.from(components)
		.where(eq(components.id, id))
		.limit(1);
	if (!existing) throw new HttpError(404, "Component not found");
	await requireProjectPermission(
		actor,
		existing.projectId,
		"ADMINISTER_PROJECTS",
	);
	await requireWritableProject(existing.projectId);
	if (expectedProjectId && existing.projectId !== expectedProjectId) {
		throw new HttpError(404, "Component not found");
	}

	const { name, description, leadId } = body;
	if (leadId && !(await validLead(leadId))) {
		throw new HttpError(400, "Unknown component lead");
	}
	const [updated] = await db
		.update(components)
		.set({
			...(name !== undefined ? { name } : {}),
			...(description !== undefined ? { description } : {}),
			...(leadId !== undefined ? { leadId } : {}),
			updatedAt: new Date(),
		})
		.where(eq(components.id, id))
		.returning();
	if (!updated) throw new HttpError(404, "Component not found");

	const lead = updated.leadId
		? (
				await db
					.select(leadColumns)
					.from(users)
					.where(eq(users.id, updated.leadId))
					.limit(1)
			)[0]
		: undefined;

	return {
		id: updated.id,
		name: updated.name,
		description: updated.description,
		lead: lead ? userRef(lead) : null,
	};
}

export async function deleteComponent(actor: CurrentUser, id: string) {
	const [existing] = await db
		.select({ projectId: components.projectId })
		.from(components)
		.where(eq(components.id, id))
		.limit(1);
	if (!existing) throw new HttpError(404, "Component not found");
	await requireProjectPermission(
		actor,
		existing.projectId,
		"ADMINISTER_PROJECTS",
	);

	const [deleted] = await db
		.delete(components)
		.where(eq(components.id, id))
		.returning({ id: components.id });
	if (!deleted) throw new HttpError(404, "Component not found");
}

export async function createVersion(
	actor: CurrentUser,
	key: string,
	body: z.output<typeof createVersionBody>,
) {
	const project = await loadProject(key);
	if (!project) throw new HttpError(404, "Project not found");
	await requireProjectPermission(actor, project.id, "ADMINISTER_PROJECTS");

	const created = await db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.id, project.id))
			.for("update");
		if (!locked) return null;

		const [last] = await tx
			.select({ sequence: versions.sequence })
			.from(versions)
			.where(eq(versions.projectId, project.id))
			.orderBy(desc(versions.sequence))
			.limit(1);

		const [version] = await tx
			.insert(versions)
			.values({
				sourceId: `local:${randomUUID()}`,
				projectId: project.id,
				name: body.name,
				description: body.description ?? null,
				startDate: body.startDate ?? null,
				releaseDate: body.releaseDate ?? null,
				released: body.released ?? false,
				sequence: (last?.sequence ?? 0) + 1,
			})
			.returning();
		return version;
	});
	if (!created) throw new HttpError(404, "Project not found");

	return {
		id: created.id,
		name: created.name,
		description: created.description,
		released: created.released,
		archived: created.archived,
		startDate: created.startDate,
		releaseDate: created.releaseDate,
	};
}

export async function updateVersion(
	actor: CurrentUser,
	id: string,
	body: z.output<typeof updateVersionBody>,
	expectedProjectId?: string,
) {
	const [existing] = await db
		.select({ projectId: versions.projectId })
		.from(versions)
		.where(eq(versions.id, id))
		.limit(1);
	if (!existing) throw new HttpError(404, "Version not found");
	await requireProjectPermission(
		actor,
		existing.projectId,
		"ADMINISTER_PROJECTS",
	);
	await requireWritableProject(existing.projectId);
	if (expectedProjectId && existing.projectId !== expectedProjectId) {
		throw new HttpError(404, "Version not found");
	}

	const { name, description, startDate, releaseDate, released, archived } =
		body;
	const [updated] = await db
		.update(versions)
		.set({
			...(name !== undefined ? { name } : {}),
			...(description !== undefined ? { description } : {}),
			...(startDate !== undefined ? { startDate } : {}),
			...(releaseDate !== undefined ? { releaseDate } : {}),
			...(released !== undefined ? { released } : {}),
			...(archived !== undefined ? { archived } : {}),
			updatedAt: new Date(),
		})
		.where(eq(versions.id, id))
		.returning();
	if (!updated) throw new HttpError(404, "Version not found");

	return {
		id: updated.id,
		name: updated.name,
		description: updated.description,
		released: updated.released,
		archived: updated.archived,
		startDate: updated.startDate,
		releaseDate: updated.releaseDate,
	};
}

export async function deleteVersion(actor: CurrentUser, id: string) {
	const [existing] = await db
		.select({ projectId: versions.projectId })
		.from(versions)
		.where(eq(versions.id, id))
		.limit(1);
	if (!existing) throw new HttpError(404, "Version not found");
	await requireProjectPermission(
		actor,
		existing.projectId,
		"ADMINISTER_PROJECTS",
	);

	const [deleted] = await db
		.delete(versions)
		.where(eq(versions.id, id))
		.returning({ id: versions.id });
	if (!deleted) throw new HttpError(404, "Version not found");
}
