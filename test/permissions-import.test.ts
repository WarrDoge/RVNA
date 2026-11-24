import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/importer/db.ts";
import {
	importPermissions,
	type PermissionImportClient,
} from "../src/importer/permissions.ts";
import { assignPermissionSchemeProject } from "../src/lib/server/admin/permission-schemes.ts";
import { syncGroups } from "../src/lib/server/auth.ts";
import {
	groups,
	permissionGrants,
	permissionLocalAssignments,
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

/** Observe every statement, including the ones a transaction runs on its own client. */
function capturePoolQueries(
	onQuery: (text: string, result: unknown) => Promise<void> | void,
) {
	const original = pool.connect.bind(pool);
	const wrapped = new WeakSet<object>();
	const wrap = (client: PoolClient) => {
		if (wrapped.has(client)) return;
		wrapped.add(client);
		const query = client.query.bind(client);
		client.query = (async (
			text: { text?: string } | string,
			...rest: unknown[]
		) => {
			const result = await (query as (...args: unknown[]) => Promise<unknown>)(
				text,
				...rest,
			);
			await onQuery(
				typeof text === "string" ? text : (text.text ?? ""),
				result,
			);
			return result;
		}) as typeof client.query;
	};
	(pool as unknown as { connect: typeof pool.connect }).connect = ((
		...args: unknown[]
	) => {
		const callback = args.at(-1);
		if (typeof callback === "function") {
			return (original as (...args: unknown[]) => unknown)(
				...args.slice(0, -1),
				(...callbackArgs: unknown[]) => {
					const client = callbackArgs[1];
					if (client) wrap(client as PoolClient);
					(callback as (...args: unknown[]) => unknown)(...callbackArgs);
				},
			);
		}
		return (async () => {
			const client = await (
				original as (...args: unknown[]) => Promise<PoolClient>
			)(...args);
			wrap(client);
			return client;
		})();
	}) as typeof pool.connect;
	return () => {
		(pool as unknown as { connect: typeof pool.connect }).connect = original;
	};
}

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

test("the groups picker pages past a short response that reports a total", async () => {
	const names = [`${tag}-page-a`, `${tag}-page-b`, `${tag}-page-c`];
	const client: PermissionImportClient = {
		async getJson<T>(
			path: string,
			params?: Record<string, string | number | boolean | undefined>,
		) {
			if (path === "/rest/api/2/groups/picker") {
				const startAt = Number(params?.startAt ?? 0);
				const groups =
					startAt === 0
						? names.slice(0, 2).map((name) => ({ name }))
						: names.slice(2).map((name) => ({ name }));
				return { groups, total: names.length } as T;
			}
			if (path === "/rest/api/2/group/member") {
				return { values: [], isLast: true } as T;
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	};

	const result = await importPermissions(client, {
		projectKeys: [],
		fullImport: false,
		fetchGlobal: false,
	});
	expect(result.report).toContain(`groups picker: ${names.length} groups`);
	const rows = await db
		.select({ name: groups.name })
		.from(groups)
		.where(inArray(groups.name, names));
	expect(rows.map((row) => row.name).sort()).toEqual(names);
});

test("the groups picker pages past a full response without a total", async () => {
	const name = `${tag}-page-full`;
	const client: PermissionImportClient = {
		async getJson<T>(
			path: string,
			params?: Record<string, string | number | boolean | undefined>,
		) {
			if (path === "/rest/api/2/groups/picker") {
				const startAt = Number(params?.startAt ?? 0);
				const groups =
					startAt === 0
						? Array.from({ length: 1000 }, () => ({ name: "" }))
						: [{ name }];
				return { groups } as T;
			}
			if (path === "/rest/api/2/group/member") {
				return { values: [], isLast: true } as T;
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	};

	const result = await importPermissions(client, {
		projectKeys: [],
		fullImport: false,
		fetchGlobal: false,
	});
	expect(result.report).toContain("groups picker: 1 groups");
	const rows = await db
		.select({ name: groups.name })
		.from(groups)
		.where(eq(groups.name, name));
	expect(rows).toHaveLength(1);
});

test("a failed group member fetch skips only that group", async () => {
	const okGroup = `${tag}-members-ok`;
	const failedGroup = `${tag}-members-failed`;
	const [failed] = await db
		.insert(groups)
		.values({ name: failedGroup, local: false })
		.returning({ id: groups.id });
	await db.insert(userGroups).values({
		userId: reporterId,
		groupId: failed.id,
		source: "jira",
	});

	const client: PermissionImportClient = {
		async getJson<T>(
			path: string,
			params?: Record<string, string | number | boolean | undefined>,
		) {
			if (path === "/rest/api/2/groups/picker") {
				return {
					groups: [{ name: okGroup }, { name: failedGroup }],
					total: 2,
				} as T;
			}
			if (path === "/rest/api/2/group/member") {
				if (params?.groupname === failedGroup) {
					throw new Error("member list unavailable");
				}
				return {
					values: [{ name: "fixture_reporter" }],
					isLast: true,
				} as T;
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	};

	try {
		const result = await importPermissions(client, {
			projectKeys: [],
			fullImport: false,
			fetchGlobal: false,
		});
		expect(
			result.report.some((line) =>
				line.includes(`group members unavailable for ${failedGroup}`),
			),
		).toBe(true);
		const kept = await db
			.select({ groupId: userGroups.groupId })
			.from(userGroups)
			.where(eq(userGroups.userId, reporterId));
		expect(kept.some((row) => row.groupId === failed.id)).toBe(true);

		const [ok] = await db
			.select({ id: groups.id })
			.from(groups)
			.where(eq(groups.name, okGroup));
		const added = await db
			.select({ groupId: userGroups.groupId })
			.from(userGroups)
			.where(eq(userGroups.userId, reporterId));
		expect(added.some((row) => row.groupId === ok.id)).toBe(true);
	} finally {
		await db.delete(userGroups).where(eq(userGroups.groupId, failed.id));
		await db.delete(groups).where(eq(groups.id, failed.id));
	}
});

test("a Jira group named like a local group does not join it", async () => {
	const localName = `${tag}-Local-Team`;
	const [local] = await db
		.insert(groups)
		.values({ name: localName, local: true })
		.returning({ id: groups.id });
	await db.insert(userGroups).values([
		{ userId: otherId, groupId: local.id, source: "local" },
		{ userId: otherId, groupId: local.id, source: "jira" },
	]);
	const client: PermissionImportClient = {
		async getJson<T>(path: string) {
			if (path === "/rest/api/2/groups/picker") {
				return {
					groups: [{ name: localName.toLowerCase() }],
					total: 1,
				} as T;
			}
			if (path === "/rest/api/2/group/member") {
				return {
					values: [{ name: "fixture_reporter" }],
					isLast: true,
				} as T;
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	};

	const result = await importPermissions(client, {
		projectKeys: [],
		fullImport: false,
		fetchGlobal: false,
	});

	expect(result.report.join("\n")).toContain("is a local group");
	const members = await db
		.select({ userId: userGroups.userId, source: userGroups.source })
		.from(userGroups)
		.where(eq(userGroups.groupId, local.id));
	expect(members).toEqual([{ userId: otherId, source: "local" }]);
	expect(
		await db
			.select({ id: groups.id })
			.from(groups)
			.where(eq(groups.name, localName.toLowerCase())),
	).toHaveLength(0);
});

test("a group created while the import runs does not abort it", async () => {
	const groupName = `${tag}-race`;
	const functionName = `test_slow_group_${run}`;
	const triggerName = `test_slow_group_${run}_trigger`;
	let pickerCalls = 0;
	let signalInsert = () => {};
	const insertStarted = new Promise<void>((resolve) => {
		signalInsert = resolve;
	});
	const makeClient = (): PermissionImportClient => ({
		async getJson<T>(path: string) {
			if (path === "/rest/api/2/groups/picker") {
				pickerCalls++;
				if (pickerCalls === 2) await insertStarted;
				return { groups: [{ name: groupName }], total: 1 } as T;
			}
			if (path === "/rest/api/2/group/member") {
				return { values: [], isLast: true } as T;
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	});

	const database = db as unknown as { insert: typeof db.insert };
	const originalInsert = database.insert.bind(db);
	database.insert = ((table: Parameters<typeof db.insert>[0]) => {
		if (table === groups) signalInsert();
		return originalInsert(table);
	}) as typeof db.insert;

	try {
		await pool.query(
			`create or replace function ${functionName}() returns trigger language plpgsql as $$
			 begin
			   if new.name = '${groupName}' then perform pg_sleep(0.5); end if;
			   return new;
			 end $$`,
		);
		await pool.query(
			`create trigger ${triggerName} before insert on groups
			 for each row execute function ${functionName}()`,
		);

		const [first, second] = await Promise.all([
			importPermissions(makeClient(), {
				projectKeys: [],
				fullImport: false,
				fetchGlobal: false,
			}),
			importPermissions(makeClient(), {
				projectKeys: [],
				fullImport: false,
				fetchGlobal: false,
			}),
		]);
		expect(first.report).toContain("groups picker: 1 groups");
		expect(second.report).toContain("groups picker: 1 groups");
		const rows = await db
			.select({ id: groups.id })
			.from(groups)
			.where(eq(groups.name, groupName));
		expect(rows).toHaveLength(1);
		expect(
			(first.counts.groups?.inserted ?? 0) +
				(second.counts.groups?.inserted ?? 0),
		).toBe(1);
		expect(
			(first.counts.groups?.unchanged ?? 0) +
				(second.counts.groups?.unchanged ?? 0),
		).toBe(1);
	} finally {
		database.insert = originalInsert;
		await pool.query(`drop trigger if exists ${triggerName} on groups`);
		await pool.query(`drop function if exists ${functionName}()`);
		await db.delete(groups).where(eq(groups.name, groupName));
	}
});

test("a role's raw payload does not repeat the whole role for every actor", async () => {
	const key = `RA${run.slice(0, 6).toUpperCase()}`;
	const source = `fixture-role-raw-${run}`;
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:raw-project`,
			key,
			name: `${tag} raw project`,
			projectType: "software",
		})
		.returning({ id: projects.id });
	const actors = Array.from({ length: 20 }, (_, index) => ({
		id: index + 1,
		displayName: `Fixture Actor ${index}`,
		type: "atlassian-user-role-actor",
		name: `fixture_actor_${index}`,
	}));
	const client: PermissionImportClient = {
		async getJson<T>(path: string) {
			if (path === "/rest/api/2/groups/picker") {
				return { groups: [], total: 0 } as T;
			}
			if (path === `/rest/api/2/project/${key}/role`) {
				return {
					Developers: `${base}/rest/api/2/project/${key}/role/77`,
				} as T;
			}
			if (path.endsWith("/role/77")) {
				return {
					id: 77,
					name: "Developers",
					description: "Fixture role",
					actors,
				} as T;
			}
			if (path === `/rest/api/2/project/${key}/permissionscheme`) {
				return {
					id: source,
					name: "Fixture role scheme",
					permissions: [],
				} as T;
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	};

	try {
		await importPermissions(client, {
			projectKeys: [key],
			fullImport: true,
			fetchGlobal: false,
		});
		const rows = await db
			.select({ raw: projectRoleActors.raw })
			.from(projectRoleActors)
			.where(eq(projectRoleActors.projectId, project.id));
		expect(rows).toHaveLength(20);
		for (const row of rows) {
			const raw = row.raw as {
				role?: { actors?: unknown };
				actor?: unknown;
			};
			expect(raw.actor).toBeDefined();
			expect(raw.role?.actors).toBeUndefined();
		}
	} finally {
		await db.delete(projects).where(eq(projects.id, project.id));
		await pool.query(
			"delete from permission_grants where scheme_id in (select id from permission_schemes where source_id = $1)",
			[source],
		);
		await pool.query("delete from permission_schemes where source_id = $1", [
			source,
		]);
	}
});

test("reapplying local assignments writes once per scheme", async () => {
	const source = `fixture-local-assignment-${run}`;
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: source,
			name: "Fixture local assignment scheme",
			projectIds: [],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	await db
		.delete(permissionLocalAssignments)
		.where(
			inArray(permissionLocalAssignments.projectId, [projectId, projectIdB]),
		);
	const otherSchemes = await db
		.select({
			id: permissionSchemes.id,
			projectIds: permissionSchemes.projectIds,
		})
		.from(permissionSchemes);
	for (const other of otherSchemes) {
		if (other.id === scheme.id) continue;
		const next = (other.projectIds ?? []).filter(
			(id) => id !== projectId && id !== projectIdB,
		);
		if (next.length !== (other.projectIds ?? []).length) {
			await db
				.update(permissionSchemes)
				.set({ projectIds: next })
				.where(eq(permissionSchemes.id, other.id));
		}
	}
	await db.insert(permissionLocalAssignments).values([
		{ projectId, schemeId: scheme.id },
		{ projectId: projectIdB, schemeId: scheme.id },
	]);

	const client: PermissionImportClient = {
		async getJson<T>(path: string) {
			if (path === "/rest/api/2/groups/picker") {
				return { groups: [], total: 0 } as T;
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	};
	const statements: string[] = [];
	const restoreQueries = capturePoolQueries((text) => {
		statements.push(text);
	});

	try {
		await importPermissions(client, {
			projectKeys: [],
			fullImport: false,
			fetchGlobal: false,
		});
	} finally {
		restoreQueries();
	}
	try {
		const updates = statements.filter((statement) =>
			statement.includes('update "permission_schemes"'),
		);
		expect(updates).toHaveLength(1);
		const [row] = await db
			.select({ projectIds: permissionSchemes.projectIds })
			.from(permissionSchemes)
			.where(eq(permissionSchemes.id, scheme.id));
		expect([...(row?.projectIds ?? [])].sort()).toEqual(
			[projectId, projectIdB].sort(),
		);
	} finally {
		await db
			.delete(permissionLocalAssignments)
			.where(
				inArray(permissionLocalAssignments.projectId, [projectId, projectIdB]),
			);
		await db
			.delete(permissionSchemes)
			.where(eq(permissionSchemes.id, scheme.id));
	}
});

test("local reconciliation waits for an admin assignment", async () => {
	const source = `fixture-race-scheme-${run}`;
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:race-project`,
			key: `PR${run.slice(0, 6).toUpperCase()}`,
			name: `${tag} race project`,
			projectType: "software",
		})
		.returning({ id: projects.id });
	const [localScheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `local:${run}-race`,
			name: "Local race scheme",
			projectIds: [project.id],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	const [importedScheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: source,
			name: "Imported race scheme",
			projectIds: [],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	await db.insert(permissionLocalAssignments).values({
		projectId: project.id,
		schemeId: localScheme.id,
	});
	await pool.query(
		"delete from permission_local_unassignments where project_id = $1",
		[project.id],
	);

	let paused = false;
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let signal = () => {};
	const started = new Promise<void>((resolve) => {
		signal = resolve;
	});
	const restoreQueries = capturePoolQueries(async (text) => {
		if (!paused && text.includes("permission_local_assignments")) {
			paused = true;
			signal();
			await gate;
		}
	});

	const client: PermissionImportClient = {
		async getJson<T>(path: string) {
			if (path === "/rest/api/2/groups/picker") {
				return { groups: [], total: 0 } as T;
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	};
	const actor = {
		id: reporterId,
		username: "fixture_reporter",
		displayName: "Fixture Reporter",
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: true,
		mustChangePassword: false,
		hasPassword: false,
	};

	try {
		const imported = importPermissions(client, {
			projectKeys: [],
			fullImport: false,
			fetchGlobal: false,
		});
		await started;
		const assigned = assignPermissionSchemeProject(actor, importedScheme.id, {
			projectId: project.id,
		});
		await new Promise((resolve) => setTimeout(resolve, 300));
		release();
		await Promise.all([imported, assigned]);

		const [assignment] = await db
			.select({ schemeId: permissionLocalAssignments.schemeId })
			.from(permissionLocalAssignments)
			.where(eq(permissionLocalAssignments.projectId, project.id));
		expect(assignment?.schemeId).toBe(importedScheme.id);

		const rows = await db
			.select({
				id: permissionSchemes.id,
				projectIds: permissionSchemes.projectIds,
			})
			.from(permissionSchemes)
			.where(
				inArray(permissionSchemes.id, [localScheme.id, importedScheme.id]),
			);
		const lists = new Map(rows.map((row) => [row.id, row.projectIds ?? []]));
		expect(lists.get(importedScheme.id)).toContain(project.id);
		expect(lists.get(localScheme.id)).not.toContain(project.id);
	} finally {
		restoreQueries();
		release();
		await pool.query(
			"delete from permission_local_assignments where project_id = $1",
			[project.id],
		);
		await pool.query(
			"delete from permission_local_unassignments where project_id = $1",
			[project.id],
		);
		await pool.query("delete from audit_log where entity_id = $1", [
			importedScheme.id,
		]);
		await db
			.delete(permissionSchemes)
			.where(
				inArray(permissionSchemes.id, [localScheme.id, importedScheme.id]),
			);
		await db.delete(projects).where(eq(projects.id, project.id));
	}
});
