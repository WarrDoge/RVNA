import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/importer/db.ts";
import {
	importPermissions,
	type PermissionImportClient,
} from "../src/importer/permissions.ts";
import { syncGroups } from "../src/lib/server/auth.ts";
import {
	groups,
	permissionGrants,
	permissionSchemes,
	projectRoleActors,
	projects,
	userGroups,
	users,
} from "../src/lib/server/schema.ts";

const run = randomUUID().slice(0, 8);
const projectKey = `PI${run.slice(0, 6).toUpperCase()}`;
const projectKeyB = `PJ${run.slice(0, 6).toUpperCase()}`;
const projectKeyC = `PK${run.slice(0, 6).toUpperCase()}`;
const tag = `permissions-fixture-${run}`;
const schemeSource = `fixture-scheme-${run}`;
const base = "https://jira.example.test";

let projectId: string;
let projectIdB: string;
let projectIdC: string;
let reporterId: string;
let otherId: string;

function client(): PermissionImportClient {
	return {
		async getJson<T>(
			path: string,
			params?: Record<string, string | number | boolean | undefined>,
		) {
			if (path === "/rest/api/2/groups/picker") {
				return {
					groups: [
						{ name: `${tag}-developers`, groupId: "1" },
						{ name: `${tag}-administrators`, groupId: "2" },
					],
					total: 2,
				} as T;
			}
			if (path === "/rest/api/2/group/member") {
				const group = String(params?.groupname);
				const values = group.endsWith("administrators")
					? [{ name: "fixture_reporter" }]
					: [
							{ name: "fixture_reporter" },
							{ name: "fixture_other" },
							{ name: "fixture_missing" },
						];
				return { values, isLast: true } as T;
			}
			if (path === `/rest/api/2/project/${projectKey}/role`) {
				return {
					Administrators: `${base}/rest/api/2/project/${projectKey}/role/10002`,
					Developers: `${base}/rest/api/2/project/${projectKey}/role/10001`,
				} as T;
			}
			if (path.endsWith("/role/10002")) {
				return {
					id: 10002,
					name: "Administrators",
					actors: [
						{
							id: 1,
							displayName: `${tag}-administrators`,
							type: "atlassian-group-role-actor",
							name: `${tag}-administrators`,
						},
						{
							id: 2,
							displayName: "Fixture Reporter",
							type: "atlassian-user-role-actor",
							name: "fixture_reporter",
						},
					],
				} as T;
			}
			if (path.endsWith("/role/10001")) {
				return {
					id: 10001,
					name: "Developers",
					actors: [
						{
							id: 3,
							displayName: "Fixture Other",
							type: "atlassian-user-role-actor",
							name: "fixture_other",
						},
					],
				} as T;
			}
			if (path === `/rest/api/2/project/${projectKey}/permissionscheme`) {
				return {
					id: schemeSource,
					name: "Fixture scheme",
					description: "Invented permission scheme",
					permissions: [
						{
							id: 1,
							permission: "BROWSE_PROJECTS",
							holder: { type: "group", parameter: `${tag}-developers` },
						},
						{
							id: 2,
							permission: "EDIT_ISSUES",
							holder: { type: "projectRole", parameter: "10001" },
						},
						{
							id: 3,
							permission: "ASSIGN_ISSUES",
							holder: { type: "user", parameter: "fixture_reporter" },
						},
						{
							id: 4,
							permission: "CREATE_ISSUES",
							holder: { type: "anyone" },
						},
						{
							id: 5,
							permission: "RESOLVE_ISSUES",
							holder: { type: "reporter" },
						},
						{
							id: 6,
							permission: "CLOSE_ISSUES",
							holder: { type: "assignee" },
						},
						{
							id: 7,
							permission: "ADMINISTER_PROJECTS",
							holder: { type: "projectLead" },
						},
						{
							id: 8,
							permission: "WORK_ON_ISSUES",
							holder: { type: "applicationRole", parameter: "jira-software" },
						},
						{
							id: 9,
							permission: "MODIFY_REPORTER",
							holder: { type: "projectRole", parameter: "10002" },
						},
						{
							id: 10,
							permission: "EDIT_SPRINT_NAME_AND_GOAL_PERMISSION",
							holder: { type: "group", parameter: `${tag}-developers` },
						},
					],
				} as T;
			}
			if (path === "/rest/api/2/permissions") {
				return { permissions: { ADMINISTER: {}, BROWSE_PROJECTS: {} } } as T;
			}
			if (path === "/rest/api/2/applicationrole") return [] as T;
			if (path === "/rest/api/2/user/permission/search") {
				throw new Error("request failed with status 400");
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	};
}

async function counts() {
	return {
		groups: Number(
			(
				await pool.query("select count(*) from groups where name like $1", [
					`${tag}%`,
				])
			).rows[0].count,
		),
		userGroups: Number(
			(
				await pool.query(
					"select count(*) from user_groups ug join groups g on g.id = ug.group_id where g.name like $1 and ug.source = 'jira'",
					[`${tag}%`],
				)
			).rows[0].count,
		),
		actors: Number(
			(
				await pool.query(
					"select count(*) from project_role_actors where project_id = $1",
					[projectId],
				)
			).rows[0].count,
		),
		grants: Number(
			(
				await pool.query(
					"select count(*) from permission_grants where scheme_id in (select id from permission_schemes where source_id = $1)",
					[schemeSource],
				)
			).rows[0].count,
		),
	};
}

beforeAll(async () => {
	await runMigrations();
	await pool.query(
		"delete from permission_grants where scheme_id in (select id from permission_schemes where source_id = $1)",
		[schemeSource],
	);
	await pool.query("delete from permission_schemes where source_id = $1", [
		schemeSource,
	]);
	await pool.query("delete from projects where key = any($1::text[])", [
		[projectKey, projectKeyB, projectKeyC],
	]);
	await pool.query("delete from groups where name like $1", [`${tag}%`]);
	await pool.query(
		"delete from users where username in ('fixture_reporter','fixture_other')",
	);
	const projectRows = await db
		.insert(projects)
		.values([
			{
				sourceId: `${tag}:project`,
				key: projectKey,
				name: `${tag} project`,
				projectType: "software",
			},
			{
				sourceId: `${tag}:project-b`,
				key: projectKeyB,
				name: `${tag} project B`,
				projectType: "software",
			},
			{
				sourceId: `${tag}:project-c`,
				key: projectKeyC,
				name: `${tag} project C`,
				projectType: "software",
			},
		])
		.returning();
	projectId = projectRows[0].id;
	projectIdB = projectRows[1].id;
	projectIdC = projectRows[2].id;
	const userRows = await db
		.insert(users)
		.values([
			{
				sourceKey: `${tag}:reporter`,
				username: "fixture_reporter",
				displayName: "Fixture Reporter",
				email: "fixture_reporter@example.test",
			},
			{
				sourceKey: `${tag}:other`,
				username: "fixture_other",
				displayName: "Fixture Other",
				email: "fixture_other@example.test",
			},
		])
		.returning();
	reporterId = userRows[0].id;
	otherId = userRows[1].id;
});

afterAll(async () => {
	await pool.query(
		"delete from permission_grants where scheme_id in (select id from permission_schemes where source_id = $1)",
		[schemeSource],
	);
	await pool.query("delete from permission_schemes where source_id = $1", [
		schemeSource,
	]);
	await pool.query("delete from projects where id = any($1::uuid[])", [
		[projectId, projectIdB, projectIdC],
	]);
	await pool.query("delete from groups where name like $1", [`${tag}%`]);
	await pool.query("delete from users where id = any($1::uuid[])", [
		[reporterId, otherId],
	]);
	await pool.end();
});

test("maps groups, memberships, roles, schemes and grants from Jira shapes", async () => {
	const result = await importPermissions(client(), {
		projectKeys: [projectKey],
		fullImport: true,
		fetchGlobal: false,
	});

	expect(result.counts.groups?.inserted).toBe(2);
	expect(result.counts.user_groups?.inserted).toBe(3);
	expect(result.counts.project_role_actors?.inserted).toBe(3);
	expect(result.counts.permission_schemes?.inserted).toBe(1);
	expect(result.counts.permission_grants?.inserted).toBe(10);

	const groupRows = await db
		.select()
		.from(groups)
		.where(like(groups.name, `${tag}%`));
	expect(groupRows).toHaveLength(2);
	expect(groupRows.every((group) => !group.local)).toBe(true);

	const memberships = await db
		.select({ name: groups.name, source: userGroups.source })
		.from(userGroups)
		.innerJoin(groups, eq(groups.id, userGroups.groupId))
		.where(like(groups.name, `${tag}%`));
	expect(memberships.filter((row) => row.source === "jira")).toHaveLength(3);

	const schemes = await db
		.select()
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, schemeSource));
	const fixtureScheme = schemes[0];
	expect(fixtureScheme?.projectIds).toEqual([projectId]);

	const grants = await db
		.select()
		.from(permissionGrants)
		.where(
			inArray(
				permissionGrants.schemeId,
				schemes.map((row) => row.id),
			),
		);
	expect(new Set(grants.map((grant) => grant.holderType))).toEqual(
		new Set([
			"anyone",
			"applicationRole",
			"assignee",
			"group",
			"projectLead",
			"projectRole",
			"reporter",
			"user",
		]),
	);
	expect(
		grants.filter((grant) => grant.permissionKey === "MODIFY_REPORTER"),
	).toHaveLength(1);
	expect(
		grants.filter(
			(grant) => grant.permissionKey === "EDIT_SPRINT_NAME_AND_GOAL_PERMISSION",
		),
	).toHaveLength(1);

	const fixtureActors = await db
		.select()
		.from(projectRoleActors)
		.where(eq(projectRoleActors.projectId, projectId));
	expect(fixtureActors).toHaveLength(3);
	expect(
		fixtureActors.find((actor) => actor.actorType === "group")?.actorParameter,
	).toBe(`${tag}-administrators`);
});

test("a second import changes nothing and keeps counts stable", async () => {
	const before = await counts();
	const second = await importPermissions(client(), {
		projectKeys: [projectKey],
		fullImport: true,
		fetchGlobal: false,
	});
	for (const [table, tableCounts] of Object.entries(second.counts)) {
		expect(tableCounts.inserted, `${table} inserted`).toBe(0);
		expect(tableCounts.updated, `${table} updated`).toBe(0);
	}
	expect(await counts()).toEqual(before);
});

test("a login keeps imported memberships and adds claim groups", async () => {
	await syncGroups(reporterId, [`${tag}-claim`]);
	const rows = await db
		.select({ name: groups.name, source: userGroups.source })
		.from(userGroups)
		.innerJoin(groups, eq(groups.id, userGroups.groupId))
		.where(eq(userGroups.userId, reporterId));
	const names = rows.map((row) => row.name);
	expect(names).toContain(`${tag}-developers`);
	expect(names).toContain(`${tag}-administrators`);
	expect(names).toContain(`${tag}-claim`);
});

test("a failed role fetch keeps that project's actors out of the stale check", async () => {
	const actor = (key: string, project: string) => ({
		sourceId: `jira:${key}:1:user:fixture-${key.toLowerCase()}`,
		projectId: project,
		roleId: "1",
		roleName: "Fixture Role",
		actorType: "user",
		actorParameter: `fixture-${key.toLowerCase()}`,
		actorDisplayName: `Fixture ${key}`,
		raw: {},
	});
	const fixtures = [
		actor(projectKey, projectId),
		actor(projectKeyB, projectIdB),
		actor(projectKeyC, projectIdC),
	];
	await db.insert(projectRoleActors).values(fixtures);

	const partial: PermissionImportClient = {
		async getJson<T>(path: string) {
			if (path === "/rest/api/2/groups/picker") {
				return { groups: [], total: 0 } as T;
			}
			if (path === `/rest/api/2/project/${projectKey}/role`) {
				throw new Error("role list failed");
			}
			if (path === `/rest/api/2/project/${projectKeyB}/role`) {
				return {} as T;
			}
			if (path === `/rest/api/2/project/${projectKeyC}/role`) {
				return {
					Role: `https://jira.example.test/rest/api/2/project/${projectKeyC}/role/1`,
				} as T;
			}
			if (path.endsWith("/role/1")) {
				throw new Error("role detail failed");
			}
			if (path.endsWith("/permissionscheme")) {
				throw new Error("scheme unavailable");
			}
			throw new Error(`unexpected ${path}`);
		},
	};

	await importPermissions(partial, {
		projectKeys: [projectKey, projectKeyB, projectKeyC],
		fullImport: true,
		fetchGlobal: false,
	});

	const remaining = await db
		.select({ sourceId: projectRoleActors.sourceId })
		.from(projectRoleActors)
		.where(
			inArray(
				projectRoleActors.sourceId,
				fixtures.map((row) => row.sourceId),
			),
		);
	expect(remaining.map((row) => row.sourceId).sort()).toEqual(
		[fixtures[0].sourceId, fixtures[2].sourceId].sort(),
	);
});

test("a full import of one project keeps another project's scheme link", async () => {
	await db
		.update(permissionSchemes)
		.set({ projectIds: [projectId, projectIdB] })
		.where(eq(permissionSchemes.sourceId, schemeSource));

	await importPermissions(client(), {
		projectKeys: [projectKey],
		fullImport: true,
		fetchGlobal: false,
	});

	const [scheme] = await db
		.select({ projectIds: permissionSchemes.projectIds })
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, schemeSource));
	expect([...(scheme?.projectIds ?? [])].sort()).toEqual(
		[projectId, projectIdB].sort(),
	);
});

test("a failed scheme fetch keeps the project link that already exists", async () => {
	await db
		.update(permissionSchemes)
		.set({ projectIds: [projectId, projectIdB] })
		.where(eq(permissionSchemes.sourceId, schemeSource));

	const partial: PermissionImportClient = {
		async getJson<T>(path: string) {
			if (path === "/rest/api/2/groups/picker") {
				return { groups: [], total: 0 } as T;
			}
			if (path.endsWith("/role")) return {} as T;
			if (path === `/rest/api/2/project/${projectKey}/permissionscheme`) {
				return {
					id: schemeSource,
					name: "Fixture scheme",
					permissions: [],
				} as T;
			}
			if (path === `/rest/api/2/project/${projectKeyB}/permissionscheme`) {
				throw new Error("scheme unavailable");
			}
			throw new Error(`unexpected ${path}`);
		},
	};

	await importPermissions(partial, {
		projectKeys: [projectKey, projectKeyB],
		fullImport: true,
		fetchGlobal: false,
	});

	const [scheme] = await db
		.select({ projectIds: permissionSchemes.projectIds })
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, schemeSource));
	expect([...(scheme?.projectIds ?? [])].sort()).toEqual(
		[projectId, projectIdB].sort(),
	);
});
