import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, exists, inArray, or, sql } from "drizzle-orm";
import type { CurrentUser } from "./auth.ts";
import { db } from "./db.ts";
import { HttpError } from "./http.ts";
import {
	groups,
	issues,
	permissionGrants,
	permissionSchemes,
	projectRoleActors,
	projects,
	userGroups,
	users,
} from "./schema.ts";

export const PERMISSION_KEYS = [
	"BROWSE_PROJECTS",
	"CREATE_ISSUES",
	"EDIT_ISSUES",
	"MODIFY_REPORTER",
	"DELETE_ISSUES",
	"ASSIGN_ISSUES",
	"ASSIGNABLE_USER",
	"RESOLVE_ISSUES",
	"CLOSE_ISSUES",
	"TRANSITION_ISSUES",
	"SCHEDULE_ISSUES",
	"MOVE_ISSUES",
	"LINK_ISSUES",
	"ADD_COMMENTS",
	"EDIT_ALL_COMMENTS",
	"EDIT_OWN_COMMENTS",
	"DELETE_ALL_COMMENTS",
	"DELETE_OWN_COMMENTS",
	"CREATE_ATTACHMENTS",
	"DELETE_ALL_ATTACHMENTS",
	"DELETE_OWN_ATTACHMENTS",
	"WORK_ON_ISSUES",
	"WORKLOG_EDIT_ALL",
	"WORKLOG_EDIT_OWN",
	"WORKLOG_DELETE_ALL",
	"WORKLOG_DELETE_OWN",
	"MANAGE_WATCHERS",
	"VIEW_VOTERS_AND_WATCHERS",
	"ADMINISTER_PROJECTS",
	"MANAGE_SPRINTS_PERMISSION",
	"EDIT_SPRINT_NAME_AND_GOAL_PERMISSION",
	"START_STOP_SPRINTS_PERMISSION",
	"SERVICEDESK_AGENT",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const BUILTIN_PROJECT_ROLES = ["admin", "member", "viewer"] as const;

export type PermissionUser = {
	id: string;
	username: string;
	groups: string[];
	isAdmin: boolean;
};

export type PermissionProject = {
	id: string;
	key: string;
	leadId: string | null;
};

export type PermissionIssue = {
	id?: string;
	projectId?: string;
	reporterId: string | null;
	assigneeId: string | null;
};

export type GrantLike = {
	permissionKey: string;
	holderType: string;
	holderParameter: string | null;
};

export type ActorLike = {
	roleId: string;
	roleName: string;
	actorType: string;
	actorParameter: string;
};

export type DecisionInput = {
	permissionKey: string;
	user: PermissionUser;
	project: PermissionProject;
	issue?: PermissionIssue | null;
	grants: GrantLike[];
	actors: ActorLike[];
	globalAdmin: boolean;
};

const MEMBER_PERMISSIONS: PermissionKey[] = [
	"BROWSE_PROJECTS",
	"CREATE_ISSUES",
	"EDIT_ISSUES",
	"MODIFY_REPORTER",
	"ASSIGN_ISSUES",
	"ASSIGNABLE_USER",
	"RESOLVE_ISSUES",
	"CLOSE_ISSUES",
	"TRANSITION_ISSUES",
	"SCHEDULE_ISSUES",
	"MOVE_ISSUES",
	"LINK_ISSUES",
	"ADD_COMMENTS",
	"EDIT_OWN_COMMENTS",
	"DELETE_OWN_COMMENTS",
	"CREATE_ATTACHMENTS",
	"DELETE_OWN_ATTACHMENTS",
	"WORK_ON_ISSUES",
	"WORKLOG_EDIT_OWN",
	"WORKLOG_DELETE_OWN",
	"MANAGE_WATCHERS",
	"VIEW_VOTERS_AND_WATCHERS",
];

/**
 * The built-in scheme used by projects that were created in RVNA and
 * therefore have no imported Jira scheme. Browse is open to signed-in users,
 * like Jira's default scheme; the project roles decide who can work and
 * administer.
 */
export const DEFAULT_SCHEME_GRANTS: GrantLike[] = [
	{
		permissionKey: "BROWSE_PROJECTS",
		holderType: "anyone",
		holderParameter: null,
	},
	...MEMBER_PERMISSIONS.filter((key) => key !== "BROWSE_PROJECTS").map(
		(permissionKey) => ({
			permissionKey,
			holderType: "projectRole" as const,
			holderParameter: "member",
		}),
	),
	...PERMISSION_KEYS.map((permissionKey) => ({
		permissionKey,
		holderType: "projectRole" as const,
		holderParameter: "admin",
	})),
	{
		permissionKey: "BROWSE_PROJECTS",
		holderType: "projectRole",
		holderParameter: "member",
	},
	{
		permissionKey: "BROWSE_PROJECTS",
		holderType: "projectRole",
		holderParameter: "viewer",
	},
	{
		permissionKey: "VIEW_VOTERS_AND_WATCHERS",
		holderType: "projectRole",
		holderParameter: "viewer",
	},
];

function lower(value: string | null | undefined) {
	return (value ?? "").toLowerCase();
}

function sameGroup(userGroups: string[], parameter: string | null) {
	const needle = lower(parameter);
	return needle !== "" && userGroups.some((group) => lower(group) === needle);
}

function matchesActor(
	user: PermissionUser,
	project: PermissionProject,
	issue: PermissionIssue | null | undefined,
	holderType: string,
	holderParameter: string | null,
	actors: ActorLike[],
) {
	switch (lower(holderType)) {
		case "anyone":
		case "applicationrole":
			return true;
		case "group":
			return sameGroup(user.groups, holderParameter);
		case "user":
			return lower(user.username) === lower(holderParameter);
		case "projectlead":
			return project.leadId === user.id;
		case "reporter":
			return Boolean(issue && issue.reporterId === user.id);
		case "assignee":
			return Boolean(issue && issue.assigneeId === user.id);
		case "projectrole": {
			const role = lower(holderParameter);
			return actors.some((actor) => {
				const roleMatches =
					lower(actor.roleId) === role || lower(actor.roleName) === role;
				return roleMatches && actorIsUser(user, actor);
			});
		}
		default:
			return false;
	}
}

export function decidePermission(input: DecisionInput): boolean {
	if (input.user.isAdmin || input.globalAdmin) return true;
	return input.grants.some(
		(grant) =>
			lower(grant.permissionKey) === lower(input.permissionKey) &&
			matchesActor(
				input.user,
				input.project,
				input.issue,
				grant.holderType,
				grant.holderParameter,
				input.actors,
			),
	);
}

type Data = {
	projects: Map<string, PermissionProject>;
	grantsByScheme: Map<string, GrantLike[]>;
	actorsByProject: Map<string, ActorLike[]>;
	schemeByProject: Map<
		string,
		{ id: string; sourceId: string; projectIds: string[]; name: string }
	>;
	globalSchemeId: string | null;
};

// The data is global, so one request loads it once even for several users; a
// script or a direct domain call outside a request keeps the per-object cache.
const requestData = new AsyncLocalStorage<{ data?: Promise<Data> }>();
const dataCache = new WeakMap<object, Promise<Data>>();

/** Run a request with one permission-data load shared by every check it makes. */
export function withPermissionData<T>(run: () => T): T {
	return requestData.run({}, run);
}

async function loadData(): Promise<Data> {
	const [projectRows, schemeRows, grantRows, actorRows] = await Promise.all([
		db
			.select({ id: projects.id, key: projects.key, leadId: projects.leadId })
			.from(projects),
		db
			.select({
				id: permissionSchemes.id,
				sourceId: permissionSchemes.sourceId,
				projectIds: permissionSchemes.projectIds,
				name: permissionSchemes.name,
			})
			.from(permissionSchemes),
		db
			.select({
				schemeId: permissionGrants.schemeId,
				permissionKey: permissionGrants.permissionKey,
				holderType: permissionGrants.holderType,
				holderParameter: permissionGrants.holderParameter,
			})
			.from(permissionGrants),
		db
			.select({
				projectId: projectRoleActors.projectId,
				roleId: projectRoleActors.roleId,
				roleName: projectRoleActors.roleName,
				actorType: projectRoleActors.actorType,
				actorParameter: projectRoleActors.actorParameter,
			})
			.from(projectRoleActors),
	]);

	const grantsByScheme = new Map<string, GrantLike[]>();
	for (const grant of grantRows) {
		const list = grantsByScheme.get(grant.schemeId) ?? [];
		list.push(grant);
		grantsByScheme.set(grant.schemeId, list);
	}
	const actorsByProject = new Map<string, ActorLike[]>();
	for (const actor of actorRows) {
		const list = actorsByProject.get(actor.projectId) ?? [];
		list.push(actor);
		actorsByProject.set(actor.projectId, list);
	}

	const schemes = schemeRows.map((scheme) => ({
		...scheme,
		projectIds: scheme.projectIds ?? [],
	}));
	const schemeByProject = new Map<string, (typeof schemes)[number]>();
	for (const scheme of schemes) {
		for (const projectId of scheme.projectIds) {
			if (!schemeByProject.has(projectId)) {
				schemeByProject.set(projectId, scheme);
			}
		}
	}

	return {
		projects: new Map(
			projectRows.map((project) => [project.id, project] as const),
		),
		grantsByScheme,
		actorsByProject,
		schemeByProject,
		globalSchemeId:
			schemeRows.find((scheme) => scheme.sourceId === "global")?.id ?? null,
	};
}

function getData(user: object) {
	const scoped = requestData.getStore();
	if (scoped) {
		if (!scoped.data) {
			scoped.data = loadData().catch((error) => {
				scoped.data = undefined;
				throw error;
			});
		}
		return scoped.data;
	}
	let promise = dataCache.get(user);
	if (!promise) {
		promise = loadData().catch((error) => {
			dataCache.delete(user);
			throw error;
		});
		dataCache.set(user, promise);
	}
	return promise;
}

function schemeForProject(data: Data, projectId: string) {
	return data.schemeByProject.get(projectId);
}

const customerRoleName = "service desk customers";

/**
 * Whether a desk that is not open to every account lets the user use its customer
 * portal: the portal-only customer holder of CREATE_ISSUES in the project's scheme
 * means the people in its "Service Desk Customers" role.
 */
export async function portalAccess(
	user: PermissionUser,
	project: PermissionProject,
) {
	const data = await getData(user);
	const scheme = schemeForProject(data, project.id);
	if (!scheme) return false;
	const grants = data.grantsByScheme.get(scheme.id) ?? [];
	const customersHoldIt = grants.some(
		(grant) =>
			lower(grant.permissionKey) === "create_issues" &&
			lower(grant.holderType) === "sd.customer.portal.only",
	);
	if (!customersHoldIt) return false;
	return (data.actorsByProject.get(project.id) ?? []).some(
		(actor) =>
			lower(actor.roleName) === customerRoleName && actorIsUser(user, actor),
	);
}

function actorIsUser(user: PermissionUser, actor: ActorLike) {
	if (lower(actor.actorType) === "user") {
		return lower(actor.actorParameter) === lower(user.username);
	}
	if (lower(actor.actorType) === "group") {
		return sameGroup(user.groups, actor.actorParameter);
	}
	return false;
}

function isGlobalAdmin(user: PermissionUser, data: Data) {
	if (user.isAdmin) return true;
	if (!data.globalSchemeId) return false;
	const grants = data.grantsByScheme.get(data.globalSchemeId) ?? [];
	return grants.some(
		(grant) =>
			lower(grant.permissionKey) === "administer" &&
			matchesActor(
				user,
				{ id: "", key: "", leadId: null },
				null,
				grant.holderType,
				grant.holderParameter,
				[],
			),
	);
}

function canWithData(
	user: PermissionUser,
	permission: string,
	project: PermissionProject,
	issue: PermissionIssue | null | undefined,
	data: Data,
) {
	const globalAdmin = isGlobalAdmin(user, data);
	if (globalAdmin) return true;

	const scheme = schemeForProject(data, project.id);
	if (!scheme) {
		return decidePermission({
			permissionKey: permission,
			user,
			project,
			issue,
			grants: DEFAULT_SCHEME_GRANTS,
			actors: data.actorsByProject.get(project.id) ?? [],
			globalAdmin,
		});
	}

	return decidePermission({
		permissionKey: permission,
		user,
		project,
		issue,
		grants: data.grantsByScheme.get(scheme.id) ?? [],
		actors: data.actorsByProject.get(project.id) ?? [],
		globalAdmin,
	});
}

export async function can(
	user: PermissionUser,
	permission: PermissionKey,
	project: PermissionProject | string,
	issue?: PermissionIssue | null,
): Promise<boolean> {
	const data = await getData(user);
	const resolved =
		typeof project === "string" ? data.projects.get(project) : project;
	if (!resolved) return false;
	return canWithData(user, permission, resolved, issue, data);
}

export async function projectForId(projectId: string) {
	const [row] = await db
		.select({ id: projects.id, key: projects.key, leadId: projects.leadId })
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1);
	return row ?? null;
}

export type ViewerLike = {
	id: string;
	username: string;
	groups?: string[];
	isAdmin?: boolean;
};

const permissionUsers = new WeakMap<object, PermissionUser>();

/** The permission view of another user, for checks such as ASSIGNABLE_USER. */
export async function permissionUserForId(
	userId: string,
): Promise<PermissionUser | null> {
	const [row] = await db
		.select({
			id: users.id,
			username: users.username,
			isAdmin: users.isAdmin,
		})
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!row) return null;
	const memberships = await db
		.select({ name: groups.name })
		.from(userGroups)
		.innerJoin(groups, eq(groups.id, userGroups.groupId))
		.where(eq(userGroups.userId, userId));
	return {
		id: row.id,
		username: row.username,
		groups: memberships.map((membership) => membership.name),
		isAdmin: row.isAdmin,
	};
}

/** One PermissionUser per viewer object, so the request-cached data is loaded once. */
export function asPermissionUser(user: ViewerLike): PermissionUser {
	let result = permissionUsers.get(user);
	if (!result) {
		result = {
			id: user.id,
			username: user.username,
			groups: user.groups ?? [],
			isAdmin: user.isAdmin ?? false,
		};
		permissionUsers.set(user, result);
	}
	return result;
}

export async function viewerProjectIds(user: ViewerLike) {
	return visibleProjectIds(asPermissionUser(user));
}

export async function visibleProjectIds(user: PermissionUser) {
	const data = await getData(user);
	const result: string[] = [];
	for (const project of data.projects.values()) {
		if (canWithData(user, "BROWSE_PROJECTS", project, null, data)) {
			result.push(project.id);
		}
	}
	return result;
}

/** Ids of the projects where the user holds the permission (administrators: all). */
export async function projectIdsWith(
	user: PermissionUser,
	permission: PermissionKey,
) {
	const data = await getData(user);
	const result: string[] = [];
	for (const project of data.projects.values()) {
		if (
			canWithData(user, "BROWSE_PROJECTS", project, null, data) &&
			canWithData(user, permission, project, null, data)
		) {
			result.push(project.id);
		}
	}
	return result;
}

export async function visibleProjects(user: PermissionUser) {
	const data = await getData(user);
	return [...data.projects.values()].filter((project) =>
		canWithData(user, "BROWSE_PROJECTS", project, null, data),
	);
}

export async function projectPermissions(
	user: PermissionUser,
	project: PermissionProject,
) {
	const data = await getData(user);
	return Object.fromEntries(
		PERMISSION_KEYS.map((key) => [
			key,
			canWithData(user, key, project, null, data),
		]),
	) as Record<PermissionKey, boolean>;
}

export async function issuePermissions(
	user: PermissionUser,
	project: PermissionProject,
	issue: PermissionIssue,
) {
	const data = await getData(user);
	return Object.fromEntries(
		PERMISSION_KEYS.map((key) => [
			key,
			canWithData(user, key, project, issue, data),
		]),
	) as Record<PermissionKey, boolean>;
}

export async function visibleUsernames(user: PermissionUser) {
	const data = await getData(user);
	if (isGlobalAdmin(user, data)) {
		const rows = await db
			.select({ username: users.username })
			.from(users)
			.where(eq(users.active, true));
		return new Set(rows.map((row) => row.username));
	}

	const visible = [...data.projects.values()].filter((project) =>
		canWithData(user, "BROWSE_PROJECTS", project, null, data),
	);
	if (visible.length === 0) return new Set<string>();

	const usernames = new Set<string>();
	const groupNames = new Set<string>();
	const leadIds = new Set<string>();
	let everyone = false;

	const addGrant = (grant: GrantLike, project: PermissionProject | null) => {
		switch (lower(grant.holderType)) {
			case "anyone":
			case "applicationrole":
				everyone = true;
				return;
			case "group": {
				const name = lower(grant.holderParameter);
				if (name !== "") groupNames.add(name);
				return;
			}
			case "user": {
				const name = lower(grant.holderParameter);
				if (name !== "") usernames.add(name);
				return;
			}
			case "projectlead":
				if (project?.leadId) leadIds.add(project.leadId);
				return;
			case "projectrole": {
				const role = lower(grant.holderParameter);
				if (role === "" || !project) return;
				for (const actor of data.actorsByProject.get(project.id) ?? []) {
					if (lower(actor.roleId) !== role && lower(actor.roleName) !== role) {
						continue;
					}
					const type = lower(actor.actorType);
					const parameter = lower(actor.actorParameter);
					if (parameter === "") continue;
					if (type === "user") usernames.add(parameter);
					else if (type === "group") groupNames.add(parameter);
				}
			}
		}
	};

	if (data.globalSchemeId) {
		for (const grant of data.grantsByScheme.get(data.globalSchemeId) ?? []) {
			if (lower(grant.permissionKey) === "administer") addGrant(grant, null);
		}
	}

	for (const project of visible) {
		const scheme = schemeForProject(data, project.id);
		const grants = scheme
			? (data.grantsByScheme.get(scheme.id) ?? [])
			: DEFAULT_SCHEME_GRANTS;
		for (const grant of grants) {
			if (lower(grant.permissionKey) === "browse_projects") {
				addGrant(grant, project);
			}
		}
	}

	if (everyone) {
		const rows = await db
			.select({ username: users.username })
			.from(users)
			.where(eq(users.active, true));
		return new Set(rows.map((row) => row.username));
	}

	const filters = [eq(users.isAdmin, true)];
	if (usernames.size > 0) {
		const rows = await db
			.select({ id: users.id, username: users.username })
			.from(users);
		const ids = rows
			.filter((row) => usernames.has(lower(row.username)))
			.map((row) => row.id);
		if (ids.length > 0) filters.push(inArray(users.id, ids));
	}
	if (leadIds.size > 0) {
		filters.push(inArray(users.id, [...leadIds]));
	}
	if (groupNames.size > 0) {
		const rows = await db
			.select({ id: groups.id, name: groups.name })
			.from(groups);
		const ids = rows
			.filter((row) => groupNames.has(lower(row.name)))
			.map((row) => row.id);
		if (ids.length > 0) {
			filters.push(
				exists(
					db
						.select({ one: sql`1` })
						.from(userGroups)
						.where(
							and(
								eq(userGroups.userId, users.id),
								inArray(userGroups.groupId, ids),
							),
						),
				),
			);
		}
	}
	const rows = await db
		.select({ username: users.username })
		.from(users)
		.where(and(eq(users.active, true), or(...filters)));
	return new Set(rows.map((row) => row.username));
}

export async function issuePermissionContext(keyOrId: string) {
	const byId =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			keyOrId,
		);
	const [row] = await db
		.select({
			id: issues.id,
			key: issues.key,
			projectId: projects.id,
			projectKey: projects.key,
			projectLeadId: projects.leadId,
			reporterId: issues.reporterId,
			assigneeId: issues.assigneeId,
		})
		.from(issues)
		.innerJoin(projects, eq(projects.id, issues.projectId))
		.where(
			byId ? eq(issues.id, keyOrId) : eq(issues.key, keyOrId.toUpperCase()),
		)
		.limit(1);
	if (!row) return null;
	return {
		id: row.id,
		key: row.key,
		project: {
			id: row.projectId,
			key: row.projectKey,
			leadId: row.projectLeadId,
		},
		reporterId: row.reporterId,
		assigneeId: row.assigneeId,
	};
}

export function permissionDenied(permission: string) {
	return `You do not have permission to ${permission} in this project`;
}

type ProjectAdminWriter = Pick<typeof db, "select" | "insert">;

/** The built-in scheme's admin role actor for a project created in the app. */
export async function addProjectAdmin(
	projectId: string,
	userId: string,
	database: ProjectAdminWriter = db,
) {
	const [user] = await database
		.select({ username: users.username })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!user) throw new HttpError(404, "User not found");
	const role = BUILTIN_PROJECT_ROLES[0];
	await database
		.insert(projectRoleActors)
		.values({
			sourceId: `local:${projectId}:admin:user:${user.username}`,
			projectId,
			roleId: role,
			roleName: role,
			actorType: "user",
			actorParameter: user.username,
			actorDisplayName: user.username,
			raw: { role, actor: user.username },
		})
		.onConflictDoNothing();
}

// The framework-free guards: they throw HttpError instead of replying, so a page load or a
// service function can use them.

/**
 * The issue Browse guard that used to be the route plugin's preHandler: a
 * missing or unreadable issue is the same 404, before any other check runs.
 */
export async function requireBrowseIssue(actor: CurrentUser, keyOrId: string) {
	const context = await issuePermissionContext(keyOrId);
	if (
		!context ||
		!(await can(actor, "BROWSE_PROJECTS", context.project, context))
	) {
		throw new HttpError(404, "Issue not found");
	}
	return context;
}

/** Browse first, then the named permission, exactly like the old request helpers. */
export async function requireIssuePermissionFor(
	actor: CurrentUser,
	keyOrId: string,
	permission: PermissionKey,
) {
	const context = await requireBrowseIssue(actor, keyOrId);
	if (!(await can(actor, permission, context.project, context))) {
		throw new HttpError(403, permissionDenied(permission));
	}
	return context;
}

/** A project the actor may browse; one that does not exist or is hidden is the same 404. */
export async function requireBrowseProject(
	actor: CurrentUser,
	projectId: string,
) {
	const project = await projectForId(projectId);
	if (!project || !(await can(actor, "BROWSE_PROJECTS", project))) {
		throw new HttpError(404, "Project not found");
	}
	return project;
}

/** Browse first, then the named project permission. */
export async function requireProjectPermissionFor(
	actor: CurrentUser,
	projectId: string,
	permission: PermissionKey,
) {
	const project = await requireBrowseProject(actor, projectId);
	if (!(await can(actor, permission, project))) {
		throw new HttpError(403, permissionDenied(permission));
	}
	return project;
}

/** Administration is for administrators: the one check below every administration function. */
export function requireAdminActor(actor: CurrentUser) {
	if (!actor.isAdmin) throw new HttpError(403, "Forbidden");
}
