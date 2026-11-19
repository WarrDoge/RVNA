import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { PERMISSION_KEYS, requireAdminActor } from "../permissions.ts";
import {
	groups,
	permissionGrants,
	permissionLocalAssignments,
	permissionLocalRemovals,
	permissionSchemes,
	projectRoleActors,
	projects,
	users,
} from "../schema.ts";
import { audit } from "./audit.ts";

const schemeParams = z.object({ id: z.uuid() });
const grantParams = z.object({ id: z.uuid(), grantId: z.uuid() });

const projectRefSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	name: z.string(),
});

const schemeSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	sourceId: z.string(),
	source: z.enum(["imported", "local"]),
	projects: z.array(projectRefSchema),
});

const grantSchema = z.object({
	id: z.uuid(),
	permissionKey: z.string(),
	holderType: z.string(),
	holderParameter: z.string().nullable(),
	source: z.enum(["imported", "local"]),
});

const roleRefSchema = z.object({ id: z.string(), name: z.string() });

const schemeDetailSchema = z.object({
	scheme: schemeSchema,
	grants: z.array(grantSchema),
	roles: z.array(roleRefSchema),
	permissionKeys: z.array(z.string()),
});

const holderTypes = [
	"projectRole",
	"group",
	"user",
	"reporter",
	"assignee",
	"projectLead",
	"anyone",
	"applicationRole",
] as const;

const createGrantBody = z.object({
	permissionKey: z.enum(PERMISSION_KEYS),
	holderType: z.enum(holderTypes),
	holderParameter: z.string().trim().max(255).optional(),
});

const copyBody = z.object({
	name: z.string().trim().min(1).max(255),
});

const assignBody = z.object({ projectId: z.uuid() });

function isLocal(sourceId: string) {
	return sourceId.startsWith("local:");
}

function sourceOf(sourceId: string): "imported" | "local" {
	return isLocal(sourceId) ? "local" : "imported";
}

async function projectMap() {
	const rows = await db
		.select({ id: projects.id, key: projects.key, name: projects.name })
		.from(projects);
	return new Map(rows.map((row) => [row.id, row]));
}

function projectsFor(
	projectIds: string[],
	byId: Map<string, { id: string; key: string; name: string }>,
) {
	return projectIds
		.map((id) => byId.get(id))
		.filter((row): row is { id: string; key: string; name: string } =>
			Boolean(row),
		)
		.sort((left, right) => left.name.localeCompare(right.name));
}

function schemeView(
	scheme: {
		id: string;
		name: string;
		description: string | null;
		sourceId: string;
		projectIds: string[];
	},
	byId: Map<string, { id: string; key: string; name: string }>,
) {
	return {
		id: scheme.id,
		name: scheme.name,
		description: scheme.description,
		sourceId: scheme.sourceId,
		source: sourceOf(scheme.sourceId),
		projects: projectsFor(scheme.projectIds ?? [], byId),
	};
}

async function loadScheme(id: string) {
	const [row] = await db
		.select()
		.from(permissionSchemes)
		.where(eq(permissionSchemes.id, id))
		.limit(1);
	if (!row || row.sourceId === "global") return null;
	return row;
}

/** Distinct role ids and names, so a scheme grant can name a role. */
async function roleRefs() {
	const rows = await db
		.selectDistinct({
			id: projectRoleActors.roleId,
			name: projectRoleActors.roleName,
		})
		.from(projectRoleActors);
	const byId = new Map<string, { id: string; name: string }>();
	for (const row of rows) byId.set(row.id.toLowerCase(), row);
	for (const name of ["admin", "member", "viewer"]) {
		if (!byId.has(name)) byId.set(name, { id: name, name });
	}
	return [...byId.values()].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
}

function holderLabel(holderType: string, holderParameter: string | null) {
	switch (holderType) {
		case "projectRole":
			return `project role ${holderParameter}`;
		case "group":
			return `group ${holderParameter}`;
		case "user":
			return `user ${holderParameter}`;
		case "projectLead":
			return "the project lead";
		case "reporter":
			return "the reporter";
		case "assignee":
			return "the assignee";
		case "anyone":
			return "anyone";
		case "applicationRole":
			return "any logged in user";
		default:
			return `${holderType} ${holderParameter ?? ""}`.trim();
	}
}

async function canonicalHolder(
	holderType: string,
	parameter: string,
): Promise<string | null> {
	if (holderType === "user") {
		const [row] = await db
			.select({ username: users.username })
			.from(users)
			.where(sql`lower(${users.username}) = ${parameter.toLowerCase()}`)
			.limit(1);
		return row?.username ?? null;
	}
	if (holderType === "group") {
		const [row] = await db
			.select({ name: groups.name })
			.from(groups)
			.where(sql`lower(${groups.name}) = ${parameter.toLowerCase()}`)
			.limit(1);
		return row?.name ?? null;
	}
	return parameter;
}

export type CreateGrantInput = z.infer<typeof createGrantBody>;
export type CopySchemeInput = z.infer<typeof copyBody>;
export type AssignSchemeInput = z.infer<typeof assignBody>;

export {
	assignBody,
	copyBody,
	createGrantBody,
	grantParams,
	grantSchema,
	schemeDetailSchema,
	schemeParams,
	schemeSchema,
};

export async function listPermissionSchemes(actor: CurrentUser) {
	requireAdminActor(actor);
	const [rows, byId] = await Promise.all([
		db
			.select()
			.from(permissionSchemes)
			.where(sql`${permissionSchemes.sourceId} <> 'global'`)
			.orderBy(sql`lower(${permissionSchemes.name})`),
		projectMap(),
	]);
	return {
		schemes: rows.map((row) =>
			schemeView({ ...row, projectIds: row.projectIds ?? [] }, byId),
		),
	};
}

export async function getPermissionScheme(actor: CurrentUser, id: string) {
	requireAdminActor(actor);
	const scheme = await loadScheme(id);
	if (!scheme) {
		throw new HttpError(404, "Permission scheme not found");
	}
	const [grants, byId, roles] = await Promise.all([
		db
			.select({
				id: permissionGrants.id,
				permissionKey: permissionGrants.permissionKey,
				holderType: permissionGrants.holderType,
				holderParameter: permissionGrants.holderParameter,
				sourceId: permissionGrants.sourceId,
			})
			.from(permissionGrants)
			.where(eq(permissionGrants.schemeId, scheme.id))
			.orderBy(
				sql`lower(${permissionGrants.permissionKey})`,
				sql`lower(${permissionGrants.holderType})`,
				sql`lower(${permissionGrants.holderParameter})`,
			),
		projectMap(),
		roleRefs(),
	]);
	return {
		scheme: schemeView(
			{ ...scheme, projectIds: scheme.projectIds ?? [] },
			byId,
		),
		grants: grants.map(({ sourceId, ...grant }) => ({
			...grant,
			source: sourceOf(sourceId),
		})),
		roles,
		permissionKeys: [...PERMISSION_KEYS],
	};
}

export async function copyPermissionScheme(
	actor: CurrentUser,
	id: string,
	body: CopySchemeInput,
) {
	requireAdminActor(actor);
	const source = await loadScheme(id);
	if (!source) {
		throw new HttpError(404, "Permission scheme not found");
	}
	const sourceGrants = await db
		.select()
		.from(permissionGrants)
		.where(eq(permissionGrants.schemeId, source.id));

	const created = await db.transaction(async (tx) => {
		const [scheme] = await tx
			.insert(permissionSchemes)
			.values({
				sourceId: `local:${randomUUID()}`,
				name: body.name,
				description: source.description,
				projectIds: [],
				raw: { copiedFrom: source.sourceId },
			})
			.returning();
		if (sourceGrants.length > 0) {
			await tx.insert(permissionGrants).values(
				sourceGrants.map((grant) => ({
					sourceId: `local:${randomUUID()}`,
					schemeId: scheme.id,
					permissionKey: grant.permissionKey,
					holderType: grant.holderType,
					holderParameter: grant.holderParameter,
					raw: { copiedFrom: grant.sourceId },
				})),
			);
		}
		await audit(tx, actor, {
			action: "permission.scheme.copy",
			entityType: "permission_scheme",
			entityId: scheme.id,
			summary: `Copied permission scheme ${source.name} to ${scheme.name}`,
			changes: {
				from: { scheme: source.name },
				to: { scheme: scheme.name, grants: sourceGrants.length },
			},
		});
		return scheme;
	});

	return {
		scheme: schemeView(
			{ ...created, projectIds: created.projectIds ?? [] },
			await projectMap(),
		),
	};
}

export async function addPermissionGrant(
	actor: CurrentUser,
	id: string,
	body: CreateGrantInput,
) {
	requireAdminActor(actor);
	const scheme = await loadScheme(id);
	if (!scheme) {
		throw new HttpError(404, "Permission scheme not found");
	}

	const needsParameter =
		body.holderType === "projectRole" ||
		body.holderType === "group" ||
		body.holderType === "user";
	const rawParameter = body.holderParameter?.trim() ?? "";
	if (needsParameter && rawParameter === "") {
		throw new HttpError(400, "Choose a holder for the permission grant");
	}
	const parameter = needsParameter
		? await canonicalHolder(body.holderType, rawParameter)
		: null;
	if (needsParameter && parameter === null) {
		throw new HttpError(404, "The permission holder was not found");
	}

	const existing = await db
		.select({ id: permissionGrants.id })
		.from(permissionGrants)
		.where(
			and(
				eq(permissionGrants.schemeId, scheme.id),
				eq(permissionGrants.permissionKey, body.permissionKey),
				eq(permissionGrants.holderType, body.holderType),
				parameter === null
					? sql`${permissionGrants.holderParameter} is null`
					: sql`lower(${permissionGrants.holderParameter}) = ${parameter.toLowerCase()}`,
			),
		)
		.limit(1);
	if (existing.length > 0) {
		throw new HttpError(409, "That permission grant already exists");
	}

	const [grant] = await db.transaction(async (tx) => {
		const rows = await tx
			.insert(permissionGrants)
			.values({
				sourceId: `local:${randomUUID()}`,
				schemeId: scheme.id,
				permissionKey: body.permissionKey,
				holderType: body.holderType,
				holderParameter: parameter,
				raw: {
					permission: body.permissionKey,
					holder: {
						type: body.holderType,
						parameter,
					},
				},
			})
			.returning();
		await audit(tx, actor, {
			action: "permission.scheme.grant.add",
			entityType: "permission_scheme",
			entityId: scheme.id,
			summary: `Added ${body.permissionKey} for ${holderLabel(body.holderType, parameter)} to ${scheme.name}`,
			changes: {
				from: null,
				to: {
					scheme: scheme.name,
					permission: body.permissionKey,
					holder: holderLabel(body.holderType, parameter),
				},
			},
		});
		return rows;
	});

	return {
		grant: {
			id: grant.id,
			permissionKey: grant.permissionKey,
			holderType: grant.holderType,
			holderParameter: grant.holderParameter,
			source: "local" as const,
		},
	};
}

export async function removePermissionGrant(
	actor: CurrentUser,
	id: string,
	grantId: string,
) {
	requireAdminActor(actor);
	const scheme = await loadScheme(id);
	if (!scheme) {
		throw new HttpError(404, "Permission scheme not found");
	}
	const [grant] = await db
		.select()
		.from(permissionGrants)
		.where(
			and(
				eq(permissionGrants.id, grantId),
				eq(permissionGrants.schemeId, scheme.id),
			),
		)
		.limit(1);
	if (!grant) {
		throw new HttpError(404, "Permission grant not found");
	}

	await db.transaction(async (tx) => {
		await tx.delete(permissionGrants).where(eq(permissionGrants.id, grant.id));
		if (!isLocal(grant.sourceId)) {
			await tx
				.insert(permissionLocalRemovals)
				.values({ sourceId: grant.sourceId })
				.onConflictDoNothing();
		}
		await audit(tx, actor, {
			action: "permission.scheme.grant.remove",
			entityType: "permission_scheme",
			entityId: scheme.id,
			summary: `Removed ${grant.permissionKey} for ${holderLabel(grant.holderType, grant.holderParameter)} from ${scheme.name}`,
			changes: {
				from: {
					scheme: scheme.name,
					permission: grant.permissionKey,
					holder: holderLabel(grant.holderType, grant.holderParameter),
				},
				to: null,
			},
		});
	});
}

export async function assignPermissionSchemeProject(
	actor: CurrentUser,
	id: string,
	body: AssignSchemeInput,
) {
	requireAdminActor(actor);
	const scheme = await loadScheme(id);
	if (!scheme) {
		throw new HttpError(404, "Permission scheme not found");
	}
	const [project] = await db
		.select({ id: projects.id, key: projects.key, name: projects.name })
		.from(projects)
		.where(eq(projects.id, body.projectId))
		.limit(1);
	if (!project) throw new HttpError(404, "Project not found");

	const allSchemes = await db
		.select({
			id: permissionSchemes.id,
			name: permissionSchemes.name,
			projectIds: permissionSchemes.projectIds,
		})
		.from(permissionSchemes);
	const previous = allSchemes.find((row) =>
		(row.projectIds ?? []).includes(project.id),
	);

	await db.transaction(async (tx) => {
		for (const row of allSchemes) {
			const ids = row.projectIds ?? [];
			const shouldHold = row.id === scheme.id;
			if (ids.includes(project.id) === shouldHold) continue;
			const next = shouldHold
				? [...new Set([...ids, project.id])]
				: ids.filter((id) => id !== project.id);
			await tx
				.update(permissionSchemes)
				.set({ projectIds: next, updatedAt: new Date() })
				.where(eq(permissionSchemes.id, row.id));
		}
		await tx
			.insert(permissionLocalAssignments)
			.values({ projectId: project.id, schemeId: scheme.id })
			.onConflictDoUpdate({
				target: permissionLocalAssignments.projectId,
				set: { schemeId: scheme.id },
			});
		await audit(tx, actor, {
			action: "permission.scheme.assign",
			entityType: "permission_scheme",
			entityId: scheme.id,
			summary: `Assigned ${project.key} to permission scheme ${scheme.name}`,
			changes: {
				from: previous ? { project: project.key, scheme: previous.name } : null,
				to: { project: project.key, scheme: scheme.name },
			},
		});
	});

	const [updated] = await db
		.select()
		.from(permissionSchemes)
		.where(eq(permissionSchemes.id, scheme.id))
		.limit(1);
	if (!updated) throw new Error("Assigned permission scheme disappeared");
	return {
		scheme: schemeView(
			{ ...updated, projectIds: updated.projectIds ?? [] },
			await projectMap(),
		),
	};
}
