import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../admin/audit.ts";
import { type CurrentUser, effectiveGroups } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import {
	DEFAULT_SCHEME_GRANTS,
	type GrantLike,
	PERMISSION_KEYS,
} from "../permissions.ts";
import { requireProjectPermission } from "../projects/access.ts";
import {
	groups,
	permissionGrants,
	permissionLocalRemovals,
	permissionSchemes,
	projectRoleActors,
	projects,
	users,
} from "../schema.ts";

export const projectParams = z.object({ key: z.string().min(1).max(100) });
export const roleParams = z.object({
	key: z.string().min(1).max(100),
	roleId: z.string().min(1),
});
export const actorParams = roleParams.extend({ actorId: z.uuid() });
export const userParams = z.object({ id: z.uuid() });

export const actorSchema = z.object({
	id: z.uuid(),
	actorType: z.enum(["user", "group"]),
	parameter: z.string(),
	displayName: z.string(),
	source: z.enum(["imported", "local"]),
});

export const roleSchema = z.object({
	id: z.string(),
	name: z.string(),
	actors: z.array(actorSchema),
	permissions: z.array(z.string()),
});

export const schemeSchema = z.object({
	id: z.uuid().nullable(),
	name: z.string(),
	source: z.enum(["imported", "local", "default"]),
});

export const rolesResponse = z.object({
	project: z.object({ id: z.uuid(), key: z.string(), name: z.string() }),
	scheme: schemeSchema,
	roles: z.array(roleSchema),
	groups: z.array(
		z.object({ id: z.uuid(), name: z.string(), local: z.boolean() }),
	),
});

export const addActorBody = z.object({
	actorType: z.enum(["user", "group"]),
	actorId: z.uuid(),
});

export const userRolesResponse = z.object({
	user: z.object({
		id: z.uuid(),
		username: z.string(),
		displayName: z.string(),
	}),
	roles: z.array(
		z.object({
			projectId: z.uuid(),
			projectKey: z.string(),
			projectName: z.string(),
			roleId: z.string(),
			roleName: z.string(),
			actorId: z.uuid().nullable(),
			viaGroups: z.array(z.string()),
		}),
	),
});

type ActorRow = {
	id: string;
	roleId: string;
	roleName: string;
	actorType: string;
	actorParameter: string;
	actorDisplayName: string | null;
	sourceId: string;
};

type RoleView = {
	id: string;
	name: string;
	actors: {
		id: string;
		actorType: "user" | "group";
		parameter: string;
		displayName: string;
		source: "imported" | "local";
	}[];
	permissions: string[];
};

function lower(value: string | null | undefined) {
	return (value ?? "").toLowerCase();
}

function isLocalSource(sourceId: string) {
	return sourceId.startsWith("local:");
}

function actorSource(sourceId: string): "imported" | "local" {
	return isLocalSource(sourceId) ? "local" : "imported";
}

function sortPermissions(keys: string[]) {
	const order = new Map(PERMISSION_KEYS.map((key, index) => [key, index]));
	return [...new Set(keys)].sort((left, right) => {
		const leftOrder = order.get(left as never);
		const rightOrder = order.get(right as never);
		if (leftOrder !== undefined && rightOrder !== undefined) {
			return leftOrder - rightOrder;
		}
		if (leftOrder !== undefined) return -1;
		if (rightOrder !== undefined) return 1;
		return left.localeCompare(right);
	});
}

function grantsForRole(
	grants: GrantLike[],
	role: { id: string; name: string },
) {
	return sortPermissions(
		grants
			.filter(
				(grant) =>
					lower(grant.holderType) === "projectrole" &&
					(lower(grant.holderParameter) === lower(role.id) ||
						lower(grant.holderParameter) === lower(role.name)),
			)
			.map((grant) => grant.permissionKey),
	);
}

/** The roles of a project: grants, actors and the built-in default scheme. */
function deriveRoles(grants: GrantLike[], actors: ActorRow[]) {
	const byId = new Map<string, RoleView>();
	const byName = new Map<string, RoleView>();

	function ensureRole(id: string, name: string) {
		const existing =
			byId.get(lower(id)) ?? byName.get(lower(name)) ?? byName.get(lower(id));
		if (existing) {
			if (!byName.has(lower(name))) byName.set(lower(name), existing);
			return existing;
		}
		const role: RoleView = { id, name, actors: [], permissions: [] };
		byId.set(lower(id), role);
		byName.set(lower(name), role);
		return role;
	}

	for (const actor of actors) {
		const role = ensureRole(actor.roleId, actor.roleName);
		const actorType = lower(actor.actorType);
		if (actorType !== "user" && actorType !== "group") continue;
		role.actors.push({
			id: actor.id,
			actorType,
			parameter: actor.actorParameter,
			displayName: actor.actorDisplayName ?? actor.actorParameter,
			source: actorSource(actor.sourceId),
		});
	}

	for (const grant of grants) {
		if (lower(grant.holderType) !== "projectrole") continue;
		const parameter = grant.holderParameter ?? "";
		if (parameter === "") continue;
		ensureRole(parameter, parameter);
	}

	for (const role of new Set(byId.values())) {
		role.permissions = grantsForRole(grants, role);
		role.actors.sort((left, right) =>
			left.displayName.localeCompare(right.displayName),
		);
	}

	return [...new Set(byId.values())].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
}

async function projectByKey(key: string) {
	const [row] = await db
		.select({
			id: projects.id,
			key: projects.key,
			name: projects.name,
			leadId: projects.leadId,
		})
		.from(projects)
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	return row ?? null;
}

async function schemeForProject(projectId: string) {
	const [scheme] = await db
		.select({
			id: permissionSchemes.id,
			sourceId: permissionSchemes.sourceId,
			name: permissionSchemes.name,
		})
		.from(permissionSchemes)
		.where(
			sql`${permissionSchemes.projectIds} @> ${JSON.stringify([projectId])}::jsonb`,
		)
		.orderBy(permissionSchemes.sourceId, permissionSchemes.id)
		.limit(1);
	return scheme ?? null;
}

async function loadRoleData(
	projectId: string,
	options: { withGroups?: boolean } = {},
) {
	const [scheme, actorRows, groupRows] = await Promise.all([
		schemeForProject(projectId),
		db
			.select({
				id: projectRoleActors.id,
				roleId: projectRoleActors.roleId,
				roleName: projectRoleActors.roleName,
				actorType: projectRoleActors.actorType,
				actorParameter: projectRoleActors.actorParameter,
				actorDisplayName: projectRoleActors.actorDisplayName,
				sourceId: projectRoleActors.sourceId,
			})
			.from(projectRoleActors)
			.where(eq(projectRoleActors.projectId, projectId)),
		options.withGroups
			? db
					.select({ id: groups.id, name: groups.name, local: groups.local })
					.from(groups)
					.orderBy(sql`lower(${groups.name})`)
			: Promise.resolve([] as { id: string; name: string; local: boolean }[]),
	]);

	const grants: GrantLike[] = scheme
		? await db
				.select({
					permissionKey: permissionGrants.permissionKey,
					holderType: permissionGrants.holderType,
					holderParameter: permissionGrants.holderParameter,
				})
				.from(permissionGrants)
				.where(eq(permissionGrants.schemeId, scheme.id))
		: DEFAULT_SCHEME_GRANTS;
	const roles = deriveRoles(grants, actorRows);

	return {
		scheme: {
			id: scheme?.id ?? null,
			name: scheme?.name ?? "Default permission scheme",
			source: scheme
				? isLocalSource(scheme.sourceId)
					? ("local" as const)
					: ("imported" as const)
				: ("default" as const),
		},
		roles,
		groups: groupRows,
	};
}

function roleByParameter(roles: RoleView[], parameter: string) {
	const needle = lower(parameter);
	return roles.find(
		(role) => lower(role.id) === needle || lower(role.name) === needle,
	);
}

export async function getProjectRoles(
	actor: CurrentUser,
	key: string,
	loaded?: { id: string; key: string; name: string; leadId: string | null },
) {
	const project = loaded ?? (await projectByKey(key));
	if (!project) throw new HttpError(404, "Project not found");
	await requireProjectPermission(actor, project.id, "ADMINISTER_PROJECTS");
	const data = await loadRoleData(project.id, { withGroups: true });
	return {
		project: { id: project.id, key: project.key, name: project.name },
		...data,
	};
}

export async function addRoleActor(
	actor: CurrentUser,
	key: string,
	roleId: string,
	body: z.output<typeof addActorBody>,
) {
	const project = await projectByKey(key);
	if (!project) throw new HttpError(404, "Project not found");
	await requireProjectPermission(actor, project.id, "ADMINISTER_PROJECTS");

	const data = await loadRoleData(project.id);
	const role = roleByParameter(data.roles, roleId);
	if (!role) throw new HttpError(404, "Role not found");

	let parameter: string;
	let displayName: string;
	if (body.actorType === "user") {
		const [user] = await db
			.select({
				username: users.username,
				displayName: users.displayName,
			})
			.from(users)
			.where(eq(users.id, body.actorId))
			.limit(1);
		if (!user) throw new HttpError(404, "User not found");
		parameter = user.username;
		displayName = user.displayName;
	} else {
		const [group] = await db
			.select({ name: groups.name })
			.from(groups)
			.where(eq(groups.id, body.actorId))
			.limit(1);
		if (!group) throw new HttpError(404, "Group not found");
		parameter = group.name;
		displayName = group.name;
	}

	const existing = await db
		.select({ id: projectRoleActors.id })
		.from(projectRoleActors)
		.where(
			and(
				eq(projectRoleActors.projectId, project.id),
				eq(projectRoleActors.roleId, role.id),
				eq(projectRoleActors.actorType, body.actorType),
				sql`lower(${projectRoleActors.actorParameter}) = ${lower(parameter)}`,
			),
		)
		.limit(1);
	if (existing.length > 0) {
		const refreshed = await loadRoleData(project.id);
		const current = roleByParameter(refreshed.roles, role.id);
		return { created: false, role: current ?? role };
	}

	const created = await db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(projectRoleActors)
			.values({
				sourceId: `local:${randomUUID()}`,
				projectId: project.id,
				roleId: role.id,
				roleName: role.name,
				actorType: body.actorType,
				actorParameter: parameter,
				actorDisplayName: displayName,
				raw: { role: role.name, actor: parameter },
			})
			.onConflictDoNothing()
			.returning({ id: projectRoleActors.id });
		if (!inserted) return false;
		await audit(tx, actor, {
			action: "project.role.actor.add",
			entityType: "project",
			entityId: project.id,
			summary: `Added ${parameter} to role ${role.name} in ${project.key}`,
			changes: {
				from: null,
				to: {
					project: project.key,
					role: role.name,
					actor: parameter,
					actorType: body.actorType,
				},
			},
		});
		return true;
	});

	const refreshed = await loadRoleData(project.id);
	const current = roleByParameter(refreshed.roles, role.id);
	if (!created) return { created: false, role: current ?? role };
	if (!current) throw new Error("Added role actor disappeared");
	return { created: true, role: current };
}

export async function removeRoleActor(
	actor: CurrentUser,
	key: string,
	roleId: string,
	actorId: string,
) {
	const project = await projectByKey(key);
	if (!project) throw new HttpError(404, "Project not found");
	await requireProjectPermission(actor, project.id, "ADMINISTER_PROJECTS");

	await db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(projectRoleActors)
			.where(
				and(
					eq(projectRoleActors.id, actorId),
					eq(projectRoleActors.projectId, project.id),
				),
			)
			.limit(1);
		if (!row) throw new HttpError(404, "Role actor not found");
		const roleMatches =
			lower(row.roleId) === lower(roleId) ||
			lower(row.roleName) === lower(roleId);
		if (!roleMatches) throw new HttpError(404, "Role actor not found");

		const [deleted] = await tx
			.delete(projectRoleActors)
			.where(
				and(
					eq(projectRoleActors.id, row.id),
					eq(projectRoleActors.projectId, project.id),
				),
			)
			.returning({ id: projectRoleActors.id });
		if (!deleted) throw new HttpError(404, "Role actor not found");
		if (!isLocalSource(row.sourceId)) {
			await tx
				.insert(permissionLocalRemovals)
				.values({ sourceId: row.sourceId })
				.onConflictDoNothing();
		}
		await audit(tx, actor, {
			action: "project.role.actor.remove",
			entityType: "project",
			entityId: project.id,
			summary: `Removed ${row.actorParameter} from role ${row.roleName} in ${project.key}`,
			changes: {
				from: {
					project: project.key,
					role: row.roleName,
					actor: row.actorParameter,
					actorType: row.actorType,
				},
				to: null,
			},
		});
	});
}

/** Administration > Users > a user: the roles that decide what they can see. */
export async function getUserProjectRoles(actor: CurrentUser, id: string) {
	if (!actor.isAdmin) throw new HttpError(403, "Forbidden");
	const [user] = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
		})
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	if (!user) throw new HttpError(404, "User not found");

	const groupNames = await effectiveGroups(user.id);
	const groupsLower = [...new Set(groupNames.map(lower))];
	const userActor = and(
		sql`lower(${projectRoleActors.actorType}) = 'user'`,
		sql`lower(${projectRoleActors.actorParameter}) = ${lower(user.username)}`,
	);
	const groupActor =
		groupsLower.length > 0
			? and(
					sql`lower(${projectRoleActors.actorType}) = 'group'`,
					inArray(sql`lower(${projectRoleActors.actorParameter})`, groupsLower),
				)
			: undefined;

	const actorRows = await db
		.select({
			id: projectRoleActors.id,
			projectId: projects.id,
			projectKey: projects.key,
			projectName: projects.name,
			roleId: projectRoleActors.roleId,
			roleName: projectRoleActors.roleName,
			actorType: projectRoleActors.actorType,
			actorParameter: projectRoleActors.actorParameter,
		})
		.from(projectRoleActors)
		.innerJoin(projects, eq(projects.id, projectRoleActors.projectId))
		.where(or(userActor, groupActor))
		.orderBy(
			sql`lower(${projects.name})`,
			sql`lower(${projectRoleActors.roleName})`,
		);

	const byRole = new Map<
		string,
		{
			projectId: string;
			projectKey: string;
			projectName: string;
			roleId: string;
			roleName: string;
			actorId: string | null;
			viaGroups: string[];
		}
	>();
	for (const row of actorRows) {
		const type = lower(row.actorType);
		let viaGroups: string[] = [];
		if (type === "group") {
			viaGroups = [row.actorParameter];
		} else if (type !== "user") {
			continue;
		}
		const key = `${row.projectId}:${lower(row.roleId)}`;
		const existing = byRole.get(key);
		if (existing) {
			if (type === "user") {
				existing.actorId = row.id;
			} else {
				existing.viaGroups.push(...viaGroups);
			}
			continue;
		}
		byRole.set(key, {
			projectId: row.projectId,
			projectKey: row.projectKey,
			projectName: row.projectName,
			roleId: row.roleId,
			roleName: row.roleName,
			actorId: type === "user" ? row.id : null,
			viaGroups,
		});
	}

	const roles = [...byRole.values()]
		.map((row) => ({
			...row,
			viaGroups: [...new Set(row.viaGroups)].sort((left, right) =>
				left.localeCompare(right),
			),
		}))
		.sort(
			(left, right) =>
				left.projectName.localeCompare(right.projectName) ||
				left.roleName.localeCompare(right.roleName),
		);
	return { user, roles };
}
