import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
	groups,
	permissionGrants,
	permissionLocalAssignments,
	permissionLocalRemovals,
	permissionLocalUnassignments,
	permissionSchemes,
	projectRoleActors,
	projects,
	userGroups,
	users,
} from "../lib/server/schema.ts";
import { db } from "./db.ts";
import {
	type Executor,
	emptyCounts,
	type ImportCounts,
	mergeCounts,
	upsertRows,
} from "./upsert.ts";

export interface JiraGroup {
	name: string;
	groupId?: string;
}

export interface JiraGroupPicker {
	groups?: JiraGroup[];
	total?: number;
	isLast?: boolean;
}

export interface JiraGroupMember {
	name: string;
	key?: string;
	displayName?: string;
	active?: boolean;
}

export interface JiraGroupMemberPage {
	values?: JiraGroupMember[];
	total?: number;
	isLast?: boolean;
	startAt?: number;
	maxResults?: number;
}

export interface JiraRoleActor {
	id?: number | string;
	displayName?: string;
	name?: string;
	type?: string;
	actorUser?: { name?: string; key?: string; displayName?: string };
	actorGroup?: { name?: string; displayName?: string };
}

export interface JiraProjectRole {
	id?: number | string;
	name?: string;
	description?: string;
	actors?: JiraRoleActor[];
}

export interface JiraPermissionHolder {
	type?: string;
	parameter?: string | number;
	expand?: string;
}

export interface JiraPermissionGrant {
	id?: number | string;
	permission?: string;
	holder?: JiraPermissionHolder;
	self?: string;
}

export interface JiraPermissionScheme {
	id: number | string;
	name?: string;
	description?: string;
	permissions?: JiraPermissionGrant[];
}

export interface PermissionImportClient {
	getJson<T>(
		path: string,
		params?: Record<string, string | number | boolean | undefined>,
	): Promise<T>;
}

export interface PermissionImportOptions {
	projectKeys: string[];
	fullImport?: boolean;
	fetchGlobal?: boolean;
}

export interface PermissionImportResult {
	counts: ImportCounts;
	removed: Record<string, number>;
	report: string[];
}

const PAGE_SIZE = 1000;
const ADMIN_SEARCH_CONCURRENCY = 5;

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

async function fetchGroups(client: PermissionImportClient) {
	const byName = new Map<string, JiraGroup>();
	let startAt = 0;
	for (let page = 0; page < 100; page++) {
		const response = await client.getJson<JiraGroupPicker>(
			"/rest/api/2/groups/picker",
			{ maxResults: PAGE_SIZE, startAt },
		);
		const batch = response.groups ?? [];
		for (const group of batch) {
			if (group.name) byName.set(group.name, group);
		}
		const total = typeof response.total === "number" ? response.total : null;
		if (batch.length === 0 || response.isLast === true) break;
		if (total !== null) {
			if (startAt + batch.length >= total) break;
		} else if (batch.length < PAGE_SIZE) {
			break;
		}
		startAt += batch.length;
	}
	return [...byName.values()];
}

async function fetchGroupMembers(
	client: PermissionImportClient,
	groupName: string,
) {
	const byName = new Map<string, JiraGroupMember>();
	let startAt = 0;
	for (let page = 0; page < 1000; page++) {
		const response = await client.getJson<JiraGroupMemberPage>(
			"/rest/api/2/group/member",
			{
				groupname: groupName,
				includeInactiveUsers: true,
				startAt,
				maxResults: 100,
			},
		);
		const batch = response.values ?? [];
		for (const member of batch) {
			if (member.name) byName.set(member.name, member);
		}
		if (response.isLast === true || batch.length === 0 || batch.length < 100) {
			break;
		}
		startAt += batch.length;
	}
	return [...byName.values()];
}

async function importGroupsAndMemberships(
	client: PermissionImportClient,
	counts: ImportCounts,
	removed: Record<string, number>,
	report: string[],
) {
	const jiraGroups = await fetchGroups(client);
	report.push(`groups picker: ${jiraGroups.length} groups`);
	const membersByGroup = new Map<string, string[]>();
	const skippedGroups = new Set<string>();
	for (const group of jiraGroups) {
		let members: JiraGroupMember[];
		try {
			members = await fetchGroupMembers(client, group.name);
		} catch (error) {
			skippedGroups.add(group.name);
			report.push(
				`group members unavailable for ${group.name}: ${errorMessage(error)}`,
			);
			continue;
		}
		membersByGroup.set(
			group.name,
			members.map((member) => member.name),
		);
	}

	const groupCounts = emptyCounts();
	const existingGroups = await db.select().from(groups);
	// A group an SSO login created may spell its name differently; it is the same group.
	const byName = new Map(
		existingGroups.map((group) => [group.name.toLowerCase(), group]),
	);
	const groupIds = new Map<string, string>();
	const localGroupIds: string[] = [];
	for (const group of jiraGroups) {
		const existing = byName.get(group.name.toLowerCase());
		if (existing?.local) {
			// An administrator owns a local group; a Jira group of the same name must not join it.
			localGroupIds.push(existing.id);
			report.push(
				`group ${group.name} is a local group: its Jira members are not imported`,
			);
			continue;
		}
		if (!existing) {
			const [created] = await db
				.insert(groups)
				.values({ name: group.name, local: false })
				.onConflictDoNothing()
				.returning();
			if (created) {
				groupIds.set(group.name, created.id);
				byName.set(group.name.toLowerCase(), created);
				groupCounts.inserted++;
				continue;
			}
			const [raced] = await db
				.select()
				.from(groups)
				.where(sql`lower(${groups.name}) = ${group.name.toLowerCase()}`)
				.limit(1);
			if (!raced) {
				report.push(`group ${group.name} could not be created`);
				continue;
			}
			groupIds.set(group.name, raced.id);
			byName.set(group.name.toLowerCase(), raced);
			groupCounts.unchanged++;
			continue;
		}
		groupIds.set(group.name, existing.id);
		groupCounts.unchanged++;
	}
	mergeCounts(counts, "groups", groupCounts);
	if (localGroupIds.length > 0) {
		const dropped = await db
			.delete(userGroups)
			.where(
				and(
					eq(userGroups.source, "jira"),
					inArray(userGroups.groupId, localGroupIds),
				),
			)
			.returning({ userId: userGroups.userId });
		removed.user_groups = (removed.user_groups ?? 0) + dropped.length;
	}

	const userRows = await db
		.select({ id: users.id, username: users.username })
		.from(users);
	const userIds = new Map(userRows.map((user) => [user.username, user.id]));
	// A group whose member list failed keeps its existing memberships.
	const importedGroupIds = [...groupIds.entries()]
		.filter(([name]) => !skippedGroups.has(name))
		.map(([, id]) => id);
	const existingMemberships = importedGroupIds.length
		? await db
				.select({
					userId: userGroups.userId,
					groupId: userGroups.groupId,
				})
				.from(userGroups)
				.where(
					and(
						eq(userGroups.source, "jira"),
						inArray(userGroups.groupId, importedGroupIds),
					),
				)
		: [];
	const existingKeys = new Set(
		existingMemberships.map((row) => `${row.userId}:${row.groupId}`),
	);
	const desiredKeys = new Set<string>();
	const membershipCounts = emptyCounts();
	let missingUsers = 0;
	for (const [groupName, members] of membersByGroup) {
		const groupId = groupIds.get(groupName);
		if (!groupId) continue;
		for (const username of members) {
			const userId = userIds.get(username);
			if (!userId) {
				missingUsers++;
				continue;
			}
			const key = `${userId}:${groupId}`;
			desiredKeys.add(key);
			if (existingKeys.has(key)) {
				membershipCounts.unchanged++;
				continue;
			}
			await db
				.insert(userGroups)
				.values({ userId, groupId, source: "jira" })
				.onConflictDoNothing();
			membershipCounts.inserted++;
		}
	}
	if (importedGroupIds.length > 0) {
		const stale = existingMemberships.filter(
			(row) => !desiredKeys.has(`${row.userId}:${row.groupId}`),
		);
		for (const row of stale) {
			await db
				.delete(userGroups)
				.where(
					and(
						eq(userGroups.userId, row.userId),
						eq(userGroups.groupId, row.groupId),
						eq(userGroups.source, "jira"),
					),
				);
		}
		removed.user_groups = (removed.user_groups ?? 0) + stale.length;
	}
	mergeCounts(counts, "user_groups", membershipCounts);
	if (missingUsers > 0) {
		report.push(`group members without a local user: ${missingUsers}`);
	}
}

function roleActorRow(
	projectId: string,
	projectKey: string,
	role: JiraProjectRole,
	actor: JiraRoleActor,
) {
	const type = (actor.type ?? "").toLowerCase().includes("group")
		? "group"
		: "user";
	const parameter =
		type === "group"
			? (actor.actorGroup?.name ??
				actor.name ??
				actor.actorGroup?.displayName ??
				"")
			: (actor.actorUser?.name ??
				actor.name ??
				actor.actorUser?.key ??
				actor.actorUser?.displayName ??
				"");
	if (!parameter) return null;
	const roleId = String(role.id ?? role.name ?? "");
	const roleName = role.name ?? roleId;
	const sourceId = `jira:${projectKey}:${roleId}:${type}:${actor.id ?? parameter}`;
	return {
		sourceId,
		projectId,
		roleId,
		roleName,
		actorType: type,
		actorParameter: parameter,
		actorDisplayName:
			actor.displayName ??
			actor.actorUser?.displayName ??
			actor.actorGroup?.displayName ??
			parameter,
		raw: {
			project: projectKey,
			role: {
				id: role.id,
				name: role.name,
				...(role.description !== undefined && {
					description: role.description,
				}),
			},
			actor,
		},
	};
}

async function importProjectRoles(
	client: PermissionImportClient,
	projectKeys: string[],
	counts: ImportCounts,
	removed: Record<string, number>,
	report: string[],
	removedLocally: Set<string>,
) {
	const projectRows = await db
		.select({ id: projects.id, key: projects.key })
		.from(projects);
	const projectIds = new Map(
		projectRows.map((project) => [project.key.toUpperCase(), project.id]),
	);
	const rows: ReturnType<typeof roleActorRow>[] = [];
	const fetchedProjectIds = new Set<string>();
	for (const key of projectKeys) {
		const projectId = projectIds.get(key.toUpperCase());
		if (!projectId) {
			report.push(`project roles skipped for unknown project ${key}`);
			continue;
		}
		let roles: Record<string, string>;
		try {
			roles = await client.getJson<Record<string, string>>(
				`/rest/api/2/project/${encodeURIComponent(key)}/role`,
			);
		} catch (error) {
			report.push(
				`project roles unavailable for ${key}: ${errorMessage(error)}`,
			);
			continue;
		}
		let complete = true;
		for (const [roleName, url] of Object.entries(roles ?? {})) {
			let role: JiraProjectRole;
			try {
				role = await client.getJson<JiraProjectRole>(url);
			} catch (error) {
				complete = false;
				report.push(
					`role ${roleName} unavailable for ${key}: ${errorMessage(error)}`,
				);
				continue;
			}
			const resolved = { ...role, name: role.name ?? roleName };
			for (const actor of role.actors ?? []) {
				const row = roleActorRow(projectId, key, resolved, actor);
				if (row) rows.push(row);
			}
		}
		if (complete) fetchedProjectIds.add(projectId);
	}

	const unique = new Map(rows.map((row) => [row?.sourceId, row] as const));
	const validRows = [...unique.values()].filter(
		(row): row is NonNullable<typeof row> =>
			row !== null && !removedLocally.has(row.sourceId),
	);
	const result = await upsertRows(
		db as Executor,
		projectRoleActors,
		validRows,
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "project_role_actors", result.counts);

	const desired = new Set(validRows.map((row) => row.sourceId));
	const projectIdsToCheck = [...fetchedProjectIds];
	if (projectIdsToCheck.length > 0) {
		const existing = await db
			.select({
				sourceId: projectRoleActors.sourceId,
				projectId: projectRoleActors.projectId,
			})
			.from(projectRoleActors)
			.where(inArray(projectRoleActors.projectId, projectIdsToCheck));
		const stale = existing.filter(
			(row) => row.sourceId.startsWith("jira:") && !desired.has(row.sourceId),
		);
		if (stale.length > 0) {
			await db.delete(projectRoleActors).where(
				inArray(
					projectRoleActors.sourceId,
					stale.map((row) => row.sourceId),
				),
			);
			removed.project_role_actors =
				(removed.project_role_actors ?? 0) + stale.length;
		}
	}
}

function schemeRow(projectId: string, scheme: JiraPermissionScheme) {
	const sourceId = String(scheme.id);
	return {
		sourceId,
		name: scheme.name ?? `Permission scheme ${sourceId}`,
		description: scheme.description ?? null,
		projectIds: [projectId],
		raw: scheme,
	};
}

function grantRow(schemeId: string, grant: JiraPermissionGrant) {
	const sourceId = `jira:grant:${schemeId}:${grant.id ?? `${grant.permission}:${grant.holder?.type}:${grant.holder?.parameter}`}`;
	return {
		sourceId,
		schemeId,
		permissionKey: grant.permission ?? "",
		holderType: grant.holder?.type ?? "unknown",
		holderParameter:
			grant.holder?.parameter === undefined
				? null
				: String(grant.holder.parameter),
		raw: grant,
	};
}

async function importSchemes(
	client: PermissionImportClient,
	projectKeys: string[],
	fullImport: boolean,
	counts: ImportCounts,
	removed: Record<string, number>,
	report: string[],
	removedLocally: Set<string>,
) {
	const projectRows = await db
		.select({ id: projects.id, key: projects.key })
		.from(projects);
	const projectIds = new Map(
		projectRows.map((project) => [project.key.toUpperCase(), project.id]),
	);
	const schemes = new Map<
		string,
		{
			sourceId: string;
			name: string;
			description: string | null;
			projectIds: string[];
			raw: JiraPermissionScheme;
		}
	>();
	const fetchedProjectIds = new Set<string>();
	for (const key of projectKeys) {
		const projectId = projectIds.get(key.toUpperCase());
		if (!projectId) {
			report.push(`permission scheme skipped for unknown project ${key}`);
			continue;
		}
		let scheme: JiraPermissionScheme;
		try {
			scheme = await client.getJson<JiraPermissionScheme>(
				`/rest/api/2/project/${encodeURIComponent(key)}/permissionscheme`,
				{
					expand: "permissions,user,group,projectRole,field,all",
				},
			);
		} catch (error) {
			report.push(
				`permission scheme unavailable for ${key}: ${errorMessage(error)}`,
			);
			continue;
		}
		fetchedProjectIds.add(projectId);
		const row = schemeRow(projectId, scheme);
		const existing = schemes.get(row.sourceId);
		if (existing) {
			existing.projectIds.push(projectId);
		} else {
			schemes.set(row.sourceId, row);
		}
	}
	for (const scheme of schemes.values()) {
		scheme.projectIds.sort();
	}

	const existingSchemes = await db
		.select({
			sourceId: permissionSchemes.sourceId,
			projectIds: permissionSchemes.projectIds,
		})
		.from(permissionSchemes);
	const bySource = new Map(
		existingSchemes.map((scheme) => [scheme.sourceId, scheme]),
	);
	for (const scheme of schemes.values()) {
		const existing = bySource.get(scheme.sourceId);
		if (!existing) continue;
		const existingIds = existing.projectIds ?? [];
		// A project this run did not read keeps the link it already had.
		const kept = fullImport
			? existingIds.filter((id) => !fetchedProjectIds.has(id))
			: existingIds;
		scheme.projectIds = [...new Set([...scheme.projectIds, ...kept])].sort();
	}

	const schemeResult = await upsertRows(
		db as Executor,
		permissionSchemes,
		[...schemes.values()],
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "permission_schemes", schemeResult.counts);

	const schemeIdBySource = new Map<string, string>();
	for (const scheme of schemes.values()) {
		const id = schemeResult.ids.get(scheme.sourceId);
		if (id) schemeIdBySource.set(scheme.sourceId, id);
	}

	const grantRows: ReturnType<typeof grantRow>[] = [];
	for (const scheme of schemes.values()) {
		const schemeId = schemeIdBySource.get(scheme.sourceId);
		if (!schemeId) continue;
		for (const grant of scheme.raw.permissions ?? []) {
			grantRows.push(grantRow(schemeId, grant));
		}
	}
	const uniqueGrants = new Map(
		grantRows
			.filter((grant) => !removedLocally.has(grant.sourceId))
			.map((grant) => [grant.sourceId, grant]),
	);
	const grantResult = await upsertRows(
		db as Executor,
		permissionGrants,
		[...uniqueGrants.values()],
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "permission_grants", grantResult.counts);

	const desired = new Set(uniqueGrants.keys());
	const schemeIds = [...schemeIdBySource.values()];
	if (schemeIds.length > 0) {
		const existing = await db
			.select({
				sourceId: permissionGrants.sourceId,
				schemeId: permissionGrants.schemeId,
			})
			.from(permissionGrants)
			.where(inArray(permissionGrants.schemeId, schemeIds));
		const stale = existing.filter(
			(row) =>
				row.sourceId.startsWith("jira:grant:") && !desired.has(row.sourceId),
		);
		if (stale.length > 0) {
			await db.delete(permissionGrants).where(
				inArray(
					permissionGrants.sourceId,
					stale.map((row) => row.sourceId),
				),
			);
			removed.permission_grants =
				(removed.permission_grants ?? 0) + stale.length;
		}
	}
}

interface UserPermissionSearch {
	users?: { name?: string; key?: string }[];
}

const JIRA_ADMINISTRATORS = "jira-administrators";

/**
 * Jira does not tell which groups hold the global ADMINISTER permission. When no
 * group holds it here, Jira's default administrators group does, if it exists. An
 * administrator can remove the grant; the removal then outlasts every import.
 */
async function jiraAdministratorsGrant(
	schemeId: string,
	removedLocally: Set<string>,
	report: string[],
) {
	const sourceId = `global:ADMINISTER:group:${JIRA_ADMINISTRATORS}`;
	if (removedLocally.has(sourceId)) return [];
	const [group] = await db
		.select({ name: groups.name })
		.from(groups)
		.where(
			and(
				sql`lower(${groups.name}) = ${JIRA_ADMINISTRATORS}`,
				eq(groups.local, false),
			),
		)
		.limit(1);
	if (!group) return [];
	const holders = await db
		.select({ sourceId: permissionGrants.sourceId })
		.from(permissionGrants)
		.where(
			and(
				eq(permissionGrants.schemeId, schemeId),
				eq(permissionGrants.permissionKey, "ADMINISTER"),
				eq(permissionGrants.holderType, "group"),
			),
		);
	const seeded = holders.some((holder) => holder.sourceId === sourceId);
	if (holders.length > 0 && !seeded) return [];
	if (!seeded) {
		report.push(
			`global ADMINISTER: no group holder found, seeded group ${group.name}`,
		);
	}
	return [
		{
			sourceId,
			schemeId,
			permissionKey: "ADMINISTER",
			holderType: "group",
			holderParameter: group.name,
			raw: {
				permission: "ADMINISTER",
				holder: { type: "group", parameter: group.name },
				seeded: true,
			},
		},
	];
}

async function importGlobalPermissions(
	client: PermissionImportClient,
	counts: ImportCounts,
	removed: Record<string, number>,
	report: string[],
	removedLocally: Set<string>,
) {
	let permissionDefinitions = 0;
	try {
		const definitions = await client.getJson<{
			permissions?: Record<string, unknown>;
		}>("/rest/api/2/permissions");
		permissionDefinitions = Object.keys(definitions.permissions ?? {}).length;
		report.push(`/permissions definitions: ${permissionDefinitions}`);
	} catch (error) {
		report.push(`/permissions unavailable: ${errorMessage(error)}`);
	}

	let applicationRoles = 0;
	try {
		const roles = await client.getJson<unknown[]>(
			"/rest/api/2/applicationrole",
		);
		applicationRoles = Array.isArray(roles) ? roles.length : 0;
		report.push(`/applicationrole roles: ${applicationRoles}`);
	} catch (error) {
		report.push(`/applicationrole unavailable: ${errorMessage(error)}`);
	}

	const admins = new Set<string>();
	let adminSearch = "unavailable";
	let adminSearchComplete = true;
	const localUsers = await db
		.select({ username: users.username })
		.from(users)
		.where(eq(users.active, true));
	try {
		for (
			let index = 0;
			index < localUsers.length;
			index += ADMIN_SEARCH_CONCURRENCY
		) {
			const chunk = localUsers.slice(index, index + ADMIN_SEARCH_CONCURRENCY);
			const results = await Promise.allSettled(
				chunk.map(async (user) => {
					const response = await client.getJson<UserPermissionSearch>(
						"/rest/api/2/user/permission/search",
						{
							permissions: "ADMINISTER",
							username: user.username,
						},
					);
					return { user, response };
				}),
			);
			for (const result of results) {
				if (result.status === "rejected") throw result.reason;
				if ((result.value.response.users ?? []).length > 0) {
					admins.add(result.value.user.username);
				}
			}
		}
		adminSearch = `user/permission/search: ${admins.size} ADMINISTER users`;
	} catch (error) {
		adminSearchComplete = false;
		adminSearch = `user/permission/search unavailable: ${errorMessage(error)}`;
	}
	report.push(adminSearch);

	let currentAdmin = false;
	try {
		const myself = await client.getJson<{ name?: string }>(
			"/rest/api/2/myself",
		);
		const mine = await client.getJson<{
			permissions?: { ADMINISTER?: { havePermission?: boolean } };
		}>("/rest/api/2/mypermissions", { permissions: "ADMINISTER" });
		currentAdmin = mine.permissions?.ADMINISTER?.havePermission === true;
		if (currentAdmin && myself.name) admins.add(myself.name);
		report.push(`mypermissions ADMINISTER: ${currentAdmin ? "true" : "false"}`);
	} catch (error) {
		report.push(`mypermissions unavailable: ${errorMessage(error)}`);
	}

	const schemeSourceId = "global";
	const [existingScheme] = await db
		.select()
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, schemeSourceId))
		.limit(1);
	const raw = {
		source: "global",
		permissionDefinitions,
		applicationRoles,
		adminUsers: [...admins].sort(),
		currentUserIsAdmin: currentAdmin,
	};
	const schemeValues = {
		sourceId: schemeSourceId,
		name: "Global permissions",
		description: "Global permission holders imported from Jira",
		projectIds: [] as string[],
		raw,
	};
	let schemeId: string;
	if (!existingScheme) {
		const [created] = await db
			.insert(permissionSchemes)
			.values(schemeValues)
			.returning({ id: permissionSchemes.id });
		schemeId = created.id;
		mergeCounts(counts, "permission_schemes", {
			inserted: 1,
			updated: 0,
			unchanged: 0,
		});
	} else {
		const changed = !isDeepStrictEqual(existingScheme.raw, raw);
		if (changed) {
			await db
				.update(permissionSchemes)
				.set({ ...schemeValues, updatedAt: new Date() })
				.where(eq(permissionSchemes.id, existingScheme.id));
			mergeCounts(counts, "permission_schemes", {
				inserted: 0,
				updated: 1,
				unchanged: 0,
			});
		} else {
			mergeCounts(counts, "permission_schemes", {
				inserted: 0,
				updated: 0,
				unchanged: 1,
			});
		}
		schemeId = existingScheme.id;
	}

	const grantRows = [...admins]
		.sort()
		.map((username) => ({
			sourceId: `global:ADMINISTER:user:${username}`,
			schemeId,
			permissionKey: "ADMINISTER",
			holderType: "user",
			holderParameter: username,
			raw: {
				permission: "ADMINISTER",
				holder: { type: "user", parameter: username },
			},
		}))
		.filter((row) => !removedLocally.has(row.sourceId));
	grantRows.push(
		...(await jiraAdministratorsGrant(schemeId, removedLocally, report)),
	);
	const result = await upsertRows(
		db as Executor,
		permissionGrants,
		grantRows,
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "permission_grants", result.counts);
	const desired = new Set(grantRows.map((row) => row.sourceId));
	const existingGrants = await db
		.select({ sourceId: permissionGrants.sourceId })
		.from(permissionGrants)
		.where(
			and(
				eq(permissionGrants.schemeId, schemeId),
				like(permissionGrants.sourceId, "global:%"),
			),
		);
	const stale = adminSearchComplete
		? existingGrants.filter((row) => !desired.has(row.sourceId))
		: [];
	if (stale.length > 0) {
		await db.delete(permissionGrants).where(
			inArray(
				permissionGrants.sourceId,
				stale.map((row) => row.sourceId),
			),
		);
		removed.permission_grants = (removed.permission_grants ?? 0) + stale.length;
	}
}

async function loadLocalRemovals() {
	const rows = await db
		.select({ sourceId: permissionLocalRemovals.sourceId })
		.from(permissionLocalRemovals);
	return new Set(rows.map((row) => row.sourceId));
}

/**
 * Jira's project list for a scheme overwrites the app's changes, so put the
 * local assignments back and keep the local removals off after the import.
 * One scheme per project.
 */
async function applyLocalProjectChanges() {
	await db.transaction(async (tx) => {
		const schemes = await tx
			.select({
				id: permissionSchemes.id,
				projectIds: permissionSchemes.projectIds,
			})
			.from(permissionSchemes)
			.where(sql`${permissionSchemes.sourceId} <> 'global'`)
			.for("update");
		const [assignments, unassignments] = await Promise.all([
			tx
				.select({
					projectId: permissionLocalAssignments.projectId,
					schemeId: permissionLocalAssignments.schemeId,
				})
				.from(permissionLocalAssignments),
			tx
				.select({ projectId: permissionLocalUnassignments.projectId })
				.from(permissionLocalUnassignments),
		]);
		if (assignments.length === 0 && unassignments.length === 0) return;

		const assignedProjects = new Set(
			assignments.map((assignment) => assignment.projectId),
		);
		const unassignedProjects = new Set(
			unassignments.map((unassignment) => unassignment.projectId),
		);
		const byScheme = new Map<string, string[]>();
		for (const assignment of assignments) {
			const list = byScheme.get(assignment.schemeId) ?? [];
			list.push(assignment.projectId);
			byScheme.set(assignment.schemeId, list);
		}
		for (const scheme of schemes) {
			const projectIds = scheme.projectIds ?? [];
			const assignedHere = new Set(byScheme.get(scheme.id) ?? []);
			let next = projectIds.filter(
				(id) =>
					assignedHere.has(id) ||
					(!assignedProjects.has(id) && !unassignedProjects.has(id)),
			);
			const added = [...assignedHere].filter((id) => !next.includes(id));
			if (added.length > 0) {
				next = [...new Set([...next, ...added])].sort();
			}
			const changed =
				next.length !== projectIds.length ||
				next.some((id, index) => id !== projectIds[index]);
			if (!changed) continue;
			await tx
				.update(permissionSchemes)
				.set({ projectIds: next, updatedAt: new Date() })
				.where(eq(permissionSchemes.id, scheme.id));
			scheme.projectIds = next;
		}
	});
}

export async function importPermissions(
	client: PermissionImportClient,
	options: PermissionImportOptions,
): Promise<PermissionImportResult> {
	const counts: ImportCounts = {};
	const removed: Record<string, number> = {};
	const report: string[] = [];
	const removedLocally = await loadLocalRemovals();
	await importGroupsAndMemberships(client, counts, removed, report);
	await importProjectRoles(
		client,
		options.projectKeys,
		counts,
		removed,
		report,
		removedLocally,
	);
	await importSchemes(
		client,
		options.projectKeys,
		options.fullImport ?? true,
		counts,
		removed,
		report,
		removedLocally,
	);
	if (options.fetchGlobal !== false) {
		await importGlobalPermissions(
			client,
			counts,
			removed,
			report,
			removedLocally,
		);
	}
	await applyLocalProjectChanges();
	return { counts, removed, report };
}
