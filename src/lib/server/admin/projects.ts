import { randomUUID } from "node:crypto";
import { lstat, realpath, rmdir, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
	and,
	asc,
	desc,
	eq,
	ilike,
	inArray,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import { projectKeyError } from "#lib/shared/project-keys.ts";
import { projectTypeSchema, userRefSchema } from "../api-schemas.ts";
import type { CurrentUser } from "../auth.ts";
import { projectAvatarSql, userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { HttpError } from "../http.ts";
import { addProjectAdmin, requireAdminActor } from "../permissions.ts";
import {
	attachments,
	fieldContexts,
	issues,
	issueTypes,
	priorities,
	projectIssueTypes,
	projectPreviousKeys,
	projects,
	projectWorkflows,
	users,
	workflows,
} from "../schema.ts";
import { pageAttachments } from "../schema-wiki.ts";
import { audit } from "./audit.ts";

const projectParams = z.object({ key: z.string().min(1).max(100) });

const adminProjectSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	type: projectTypeSchema,
	category: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	lead: userRefSchema.nullable(),
	issueCount: z.number().int(),
	archived: z.boolean(),
	previousKeys: z.array(z.string()),
});

type AdminProject = z.infer<typeof adminProjectSchema>;

const descriptionBody = z.string().trim().max(10_000);
const nameBody = z.string().trim().min(1).max(255);

const createBody = z.object({
	name: nameBody,
	key: z.string().trim().max(64),
	type: projectTypeSchema,
	leadId: z.uuid().optional(),
	description: descriptionBody.optional(),
	templateProjectKey: z.string().trim().optional(),
});

const updateBody = z.object({
	name: nameBody.optional(),
	key: z.string().trim().max(64).optional(),
	description: descriptionBody.nullable().optional(),
	leadId: z.uuid().nullable().optional(),
	type: projectTypeSchema.optional(),
	category: z.string().trim().max(255).nullable().optional(),
});

const deleteBody = z.object({ confirmKey: z.string().max(255) });

const listQuery = z.object({
	query: z.string().trim().max(255).default(""),
	archived: z.enum(["all", "true", "false"]).default("all"),
});

function likePattern(query: string) {
	return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

async function previousKeysByProject(projectId?: string) {
	const rows = await db
		.select({
			projectId: projectPreviousKeys.projectId,
			key: projectPreviousKeys.key,
		})
		.from(projectPreviousKeys)
		.where(projectId ? eq(projectPreviousKeys.projectId, projectId) : undefined)
		.orderBy(asc(projectPreviousKeys.createdAt), asc(projectPreviousKeys.key));

	const map = new Map<string, string[]>();
	for (const row of rows) {
		const keys = map.get(row.projectId) ?? [];
		keys.push(row.key);
		map.set(row.projectId, keys);
	}
	return map;
}

const rowColumns = {
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

type Row = {
	id: string;
	key: string;
	name: string;
	description: string | null;
	type: "software" | "service_desk";
	category: string | null;
	avatarUrl: string | null;
	archived: boolean;
	issueCount: number;
	leadId: string | null;
	leadUsername: string | null;
	leadDisplayName: string | null;
	leadAvatarUrl: string | null;
};

function toAdminProject(row: Row, previousKeys: string[]): AdminProject {
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
		previousKeys,
		lead:
			row.leadId && row.leadUsername && row.leadDisplayName
				? {
						id: row.leadId,
						username: row.leadUsername,
						displayName: row.leadDisplayName,
						avatarUrl: row.leadAvatarUrl,
					}
				: null,
	};
}

async function loadAdminProject(projectId: string) {
	const [row] = await db
		.select(rowColumns)
		.from(projects)
		.leftJoin(users, eq(users.id, projects.leadId))
		.where(eq(projects.id, projectId))
		.limit(1);
	if (!row) return null;
	const previous = await previousKeysByProject(row.id);
	return toAdminProject(row, previous.get(row.id) ?? []);
}

async function projectByKey(key: string) {
	const [row] = await db
		.select()
		.from(projects)
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	return row ?? null;
}

/** The project that owns `key`, as a current or as a previous key. */
async function keyHolder(key: string) {
	const [current] = await db
		.select({ id: projects.id, key: projects.key, name: projects.name })
		.from(projects)
		.where(eq(projects.key, key))
		.limit(1);
	if (current) return current;

	const [previous] = await db
		.select({ id: projects.id, key: projects.key, name: projects.name })
		.from(projectPreviousKeys)
		.innerJoin(projects, eq(projects.id, projectPreviousKeys.projectId))
		.where(eq(projectPreviousKeys.key, key))
		.limit(1);
	return previous ?? null;
}

async function activeUser(userId: string) {
	const [row] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.id, userId), eq(users.active, true)))
		.limit(1);
	return row ?? null;
}

/** A concurrent create or rename can still hit one of the key uniques. */
function conflict(error: unknown) {
	const source = (error as { cause?: unknown } | null)?.cause ?? error;
	const { code, constraint } = (source ?? {}) as {
		code?: string;
		constraint?: string;
	};
	if (code !== "23505") return null;
	if (
		constraint === "projects_key_unique" ||
		constraint === "project_previous_keys_key_unique"
	) {
		return "That project key is already in use";
	}
	return null;
}

/** Copy issue types, workflow assignments and field contexts from a template project. */
async function copyTemplate(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	projectId: string,
	templateId: string,
) {
	const types = await tx
		.select({ issueTypeId: projectIssueTypes.issueTypeId })
		.from(projectIssueTypes)
		.where(eq(projectIssueTypes.projectId, templateId));
	if (types.length > 0) {
		await tx.insert(projectIssueTypes).values(
			types.map((type) => ({
				sourceId: `local:${randomUUID()}`,
				projectId,
				issueTypeId: type.issueTypeId,
			})),
		);
	}

	const assignments = await tx
		.select({
			issueTypeId: projectWorkflows.issueTypeId,
			workflowId: projectWorkflows.workflowId,
		})
		.from(projectWorkflows)
		.where(eq(projectWorkflows.projectId, templateId));
	if (assignments.length > 0) {
		await tx.insert(projectWorkflows).values(
			assignments.map((assignment) => ({
				sourceId: `local:${randomUUID()}`,
				projectId,
				issueTypeId: assignment.issueTypeId,
				workflowId: assignment.workflowId,
			})),
		);
	}

	const contexts = await tx
		.select({
			fieldId: fieldContexts.fieldId,
			issueTypeId: fieldContexts.issueTypeId,
		})
		.from(fieldContexts)
		.where(eq(fieldContexts.projectId, templateId));
	if (contexts.length > 0) {
		await tx.insert(fieldContexts).values(
			contexts.map((context) => ({
				fieldId: context.fieldId,
				projectId,
				issueTypeId: context.issueTypeId,
			})),
		);
	}
}

/** The default set: every issue type plus the workflow most projects use as their default. */
async function copyDefaultSet(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	projectId: string,
) {
	const types = await tx.select({ id: issueTypes.id }).from(issueTypes);
	if (types.length > 0) {
		await tx.insert(projectIssueTypes).values(
			types.map((type) => ({
				sourceId: `local:${randomUUID()}`,
				projectId,
				issueTypeId: type.id,
			})),
		);
	}

	const [defaultWorkflow] = await tx
		.select({
			workflowId: projectWorkflows.workflowId,
			uses: sql<number>`count(*)::int`,
		})
		.from(projectWorkflows)
		.innerJoin(workflows, eq(workflows.id, projectWorkflows.workflowId))
		.where(isNull(projectWorkflows.issueTypeId))
		.groupBy(projectWorkflows.workflowId, workflows.name)
		.orderBy(desc(sql`count(*)`), asc(workflows.name))
		.limit(1);
	if (defaultWorkflow) {
		await tx.insert(projectWorkflows).values({
			sourceId: `local:${randomUUID()}`,
			projectId,
			issueTypeId: null,
			workflowId: defaultWorkflow.workflowId,
		});
	}
}

export type CreateProjectInput = z.infer<typeof createBody>;
export type UpdateProjectInput = z.infer<typeof updateBody>;
export type DeleteProjectInput = z.infer<typeof deleteBody>;
export type ListProjectsQuery = z.infer<typeof listQuery>;

export {
	adminProjectSchema,
	createBody,
	deleteBody,
	listQuery,
	projectParams,
	updateBody,
};

export async function listAdminProjects(
	actor: CurrentUser,
	query: ListProjectsQuery,
) {
	requireAdminActor(actor);
	const { query: text, archived } = query;
	const filters: SQL[] = [];
	if (text !== "") {
		const pattern = likePattern(text);
		const matches = or(
			ilike(projects.name, pattern),
			ilike(projects.key, pattern),
		);
		if (matches) filters.push(matches);
	}
	if (archived !== "all") {
		filters.push(eq(projects.archived, archived === "true"));
	}

	const rows = await db
		.select(rowColumns)
		.from(projects)
		.leftJoin(users, eq(users.id, projects.leadId))
		.where(filters.length > 0 ? and(...filters) : undefined)
		.orderBy(asc(projects.name));

	const previous = await previousKeysByProject();
	return rows.map((row) => toAdminProject(row, previous.get(row.id) ?? []));
}

export async function createAdminProject(
	actor: CurrentUser,
	body: CreateProjectInput,
) {
	requireAdminActor(actor);
	const invalidKey = projectKeyError(body.key);
	if (invalidKey) throw new HttpError(400, invalidKey);

	// Best effort: imported projects can share a name, so there is no unique index.
	const [sameName] = await db
		.select({ key: projects.key })
		.from(projects)
		.where(sql`lower(${projects.name}) = lower(${body.name})`)
		.limit(1);
	if (sameName) {
		throw new HttpError(
			409,
			`A project named "${body.name}" already exists (${sameName.key})`,
		);
	}

	const holder = await keyHolder(body.key);
	if (holder) {
		throw new HttpError(
			409,
			`The key ${body.key} is already used by ${holder.name} (${holder.key})`,
		);
	}

	if (body.leadId && !(await activeUser(body.leadId))) {
		throw new HttpError(400, "Unknown project lead");
	}

	let template: { id: string; key: string } | null = null;
	if (body.templateProjectKey) {
		const [row] = await db
			.select({ id: projects.id, key: projects.key })
			.from(projects)
			.where(eq(projects.key, body.templateProjectKey.toUpperCase()))
			.limit(1);
		if (!row) {
			throw new HttpError(404, "Template project not found");
		}
		template = row;
	}

	let created: { id: string };
	try {
		created = await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(projects)
				.values({
					sourceId: `local:${randomUUID()}`,
					key: body.key,
					name: body.name,
					description: body.description ?? null,
					leadId: body.leadId ?? actor.id,
					projectType: body.type,
				})
				.returning({ id: projects.id, key: projects.key });

			if (template) {
				await copyTemplate(tx, row.id, template.id);
			} else {
				await copyDefaultSet(tx, row.id);
			}

			await addProjectAdmin(row.id, body.leadId ?? actor.id, tx);

			await audit(tx, actor, {
				action: "project.create",
				entityType: "project",
				entityId: row.id,
				summary: `Created project ${body.key} (${body.name})`,
				changes: {
					to: {
						key: body.key,
						name: body.name,
						type: body.type,
						template: template?.key ?? null,
					},
				},
			});
			return row;
		});
	} catch (error) {
		const message = conflict(error);
		if (message) throw new HttpError(409, message);
		throw error;
	}

	const project = await loadAdminProject(created.id);
	if (!project) throw new HttpError(404, "Project not found");
	return project;
}

export async function updateAdminProject(
	actor: CurrentUser,
	key: string,
	body: UpdateProjectInput,
) {
	requireAdminActor(actor);
	const project = await projectByKey(key);
	if (!project) throw new HttpError(404, "Project not found");

	const nextKey = body.key ?? project.key;
	if (body.key !== undefined) {
		const invalidKey = projectKeyError(body.key);
		if (invalidKey) throw new HttpError(400, invalidKey);
	}

	if (
		body.name !== undefined &&
		body.name.toLowerCase() !== project.name.toLowerCase()
	) {
		const [sameName] = await db
			.select({ key: projects.key })
			.from(projects)
			.where(
				and(
					sql`lower(${projects.name}) = lower(${body.name})`,
					sql`${projects.id} <> ${project.id}`,
				),
			)
			.limit(1);
		if (sameName) {
			throw new HttpError(
				409,
				`A project named "${body.name}" already exists (${sameName.key})`,
			);
		}
	}

	if (nextKey !== project.key) {
		const holder = await keyHolder(nextKey);
		if (holder && holder.id !== project.id) {
			throw new HttpError(
				409,
				`The key ${nextKey} is already used by ${holder.name} (${holder.key})`,
			);
		}
	}

	if (body.leadId && !(await activeUser(body.leadId))) {
		throw new HttpError(400, "Unknown project lead");
	}

	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	if (body.name !== undefined && body.name !== project.name) {
		from.name = project.name;
		to.name = body.name;
	}
	if (
		body.description !== undefined &&
		body.description !== project.description
	) {
		from.description = project.description;
		to.description = body.description;
	}
	if (body.type !== undefined && body.type !== project.projectType) {
		from.type = project.projectType;
		to.type = body.type;
	}
	if (body.category !== undefined && body.category !== project.categoryName) {
		from.category = project.categoryName;
		to.category = body.category;
	}
	if (body.leadId !== undefined && body.leadId !== project.leadId) {
		from.leadId = project.leadId;
		to.leadId = body.leadId;
	}
	const keyChanged = nextKey !== project.key;
	if (keyChanged) {
		from.key = project.key;
		to.key = nextKey;
	}

	let renamedIssues = 0;
	try {
		await db.transaction(async (tx) => {
			if (keyChanged) {
				// Two steps so no row can collide with a key that is still in use.
				await tx
					.update(issues)
					.set({ key: sql`${`~${project.id}-`} || ${issues.key}` })
					.where(eq(issues.projectId, project.id));
				const renamed = await tx
					.update(issues)
					.set({ key: sql`${`${nextKey}-`} || ${issues.number}` })
					.where(eq(issues.projectId, project.id))
					.returning({ id: issues.id });
				renamedIssues = renamed.length;

				await tx
					.delete(projectPreviousKeys)
					.where(
						and(
							eq(projectPreviousKeys.projectId, project.id),
							eq(projectPreviousKeys.key, nextKey),
						),
					);
				await tx
					.insert(projectPreviousKeys)
					.values({ projectId: project.id, key: project.key });
			}

			await tx
				.update(projects)
				.set({
					...(body.name !== undefined ? { name: body.name } : {}),
					...(keyChanged ? { key: nextKey } : {}),
					...(body.description !== undefined
						? { description: body.description }
						: {}),
					...(body.leadId !== undefined ? { leadId: body.leadId } : {}),
					...(body.type !== undefined ? { projectType: body.type } : {}),
					...(body.category !== undefined
						? { categoryName: body.category }
						: {}),
					updatedAt: new Date(),
				})
				.where(eq(projects.id, project.id));

			if (
				body.leadId !== undefined &&
				body.leadId !== null &&
				body.leadId !== project.leadId
			) {
				await addProjectAdmin(project.id, body.leadId, tx);
			}

			await audit(tx, actor, {
				action: "project.update",
				entityType: "project",
				entityId: project.id,
				summary: keyChanged
					? `Changed the key of project ${project.key} to ${nextKey}`
					: `Updated project ${nextKey}`,
				changes: {
					from,
					to,
					...(keyChanged ? { renamedIssues } : {}),
				},
			});
		});
	} catch (error) {
		const message = conflict(error);
		if (message) throw new HttpError(409, message);
		throw error;
	}

	const updated = await loadAdminProject(project.id);
	if (!updated) throw new HttpError(404, "Project not found");
	return updated;
}

export async function setAdminProjectArchived(
	actor: CurrentUser,
	key: string,
	archived: boolean,
) {
	requireAdminActor(actor);
	const project = await projectByKey(key);
	if (!project) throw new HttpError(404, "Project not found");

	if (project.archived !== archived) {
		const action = archived ? "archive" : "restore";
		await db.transaction(async (tx) => {
			await tx
				.update(projects)
				.set({ archived, updatedAt: new Date() })
				.where(eq(projects.id, project.id));
			await audit(tx, actor, {
				action: `project.${action}`,
				entityType: "project",
				entityId: project.id,
				summary: `${archived ? "Archived" : "Restored"} project ${project.key}`,
				changes: {
					from: { archived: project.archived },
					to: { archived },
				},
			});
		});
	}

	const updated = await loadAdminProject(project.id);
	if (!updated) throw new HttpError(404, "Project not found");
	return updated;
}

export async function deleteAdminProject(
	actor: CurrentUser,
	key: string,
	body: DeleteProjectInput,
) {
	requireAdminActor(actor);
	const project = await projectByKey(key);
	if (!project) throw new HttpError(404, "Project not found");
	if (body.confirmKey.trim() !== project.key) {
		throw new HttpError(400, "Type the project key to confirm");
	}

	const files = await db
		.select({
			storagePath: attachments.storagePath,
			sha256: attachments.sha256,
		})
		.from(attachments)
		.innerJoin(issues, eq(issues.id, attachments.issueId))
		.where(eq(issues.projectId, project.id));

	const [counted] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(issues)
		.where(eq(issues.projectId, project.id));

	await db.transaction(async (tx) => {
		await audit(tx, actor, {
			action: "project.delete",
			entityType: "project",
			entityId: project.id,
			summary: `Deleted project ${project.key} (${project.name}) with ${counted?.total ?? 0} issues`,
			changes: {
				from: {
					key: project.key,
					name: project.name,
					issues: counted?.total ?? 0,
				},
			},
		});
		await tx.delete(projects).where(eq(projects.id, project.id));
	});

	try {
		await removeUnreferencedFiles(files);
		await removeUnreferencedAvatar(project.avatarFile);
	} catch (error) {
		console.error("project file cleanup:", error);
	}
}

async function containedPath(root: string, relative: string) {
	const path = resolve(root, relative);
	const parent = dirname(path);
	const [info, realParent] = await Promise.all([
		lstat(path).catch(() => null),
		realpath(parent).catch(() => null),
	]);
	if (!info || info.isSymbolicLink() || realParent !== parent) return null;
	return path.startsWith(root + sep) ? path : null;
}

/** Best effort: drop attachment files (and their content directories) nothing references any more. */
async function removeUnreferencedFiles(
	files: { storagePath: string; sha256: string }[],
) {
	if (files.length === 0) return;
	const root = resolve(env.ATTACHMENTS_DIR);
	const realRoot = await realpath(root).catch(() => root);
	const paths = [...new Set(files.map((file) => file.storagePath))];
	const hashes = [...new Set(files.map((file) => file.sha256))];

	const [referenced, pageReferenced, attachmentHashes, pageHashes] =
		await Promise.all([
			db
				.select({ storagePath: attachments.storagePath })
				.from(attachments)
				.where(inArray(attachments.storagePath, paths)),
			db
				.select({ storagePath: pageAttachments.storagePath })
				.from(pageAttachments)
				.where(inArray(pageAttachments.storagePath, paths)),
			db
				.select({ sha256: attachments.sha256 })
				.from(attachments)
				.where(inArray(attachments.sha256, hashes)),
			db
				.select({ sha256: pageAttachments.sha256 })
				.from(pageAttachments)
				.where(inArray(pageAttachments.sha256, hashes)),
		]);
	const referencedPaths = new Set(
		[...referenced, ...pageReferenced].map((row) => row.storagePath),
	);
	const referencedHashes = new Set(
		[...attachmentHashes, ...pageHashes].map((row) => row.sha256),
	);

	for (const storagePath of paths) {
		if (referencedPaths.has(storagePath)) continue;
		const path = await containedPath(realRoot, storagePath);
		if (!path) continue;
		await unlink(path).catch(() => undefined);
	}

	for (const hash of hashes) {
		if (referencedHashes.has(hash)) continue;
		const directory = await containedPath(realRoot, hash);
		if (!directory) continue;
		// rmdir, not rm -r: an upload may have staged a file in this directory.
		await rmdir(directory).catch(() => undefined);
	}
}

/** Best effort: drop an avatar file nothing references any more. */
async function removeUnreferencedAvatar(file: string | null) {
	if (!file) return;
	const root = resolve(env.AVATARS_DIR);
	const realRoot = await realpath(root).catch(() => root);
	const [usersWith, projectsWith, typesWith, prioritiesWith] =
		await Promise.all([
			db
				.select({ id: users.id })
				.from(users)
				.where(eq(users.avatarFile, file))
				.limit(1),
			db
				.select({ id: projects.id })
				.from(projects)
				.where(eq(projects.avatarFile, file))
				.limit(1),
			db
				.select({ id: issueTypes.id })
				.from(issueTypes)
				.where(eq(issueTypes.iconFile, file))
				.limit(1),
			db
				.select({ id: priorities.id })
				.from(priorities)
				.where(eq(priorities.iconFile, file))
				.limit(1),
		]);
	if (
		usersWith.length > 0 ||
		projectsWith.length > 0 ||
		typesWith.length > 0 ||
		prioritiesWith.length > 0
	) {
		return;
	}
	const path = await containedPath(realRoot, file);
	if (path) await unlink(path).catch(() => undefined);
}
