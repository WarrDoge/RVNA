import { and, eq, inArray, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
	importPermissions,
	type PermissionImportClient,
} from "../src/importer/permissions.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	auditLog,
	groups,
	permissionGrants,
	permissionLocalAssignments,
	permissionLocalRemovals,
	permissionSchemes,
	projectRoleActors,
} from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData, swapTransaction } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const projectKey = fixtureKey(run);
const otherKey = `SB${run.slice(0, 5).toUpperCase()}`;
const schemeSource = `test:${run}:imported-scheme`;
const importedGrantSource = (schemeId: string) => `jira:grant:${schemeId}:1`;
const groupName = `t-${run}-global-group`;

let app: TestApp;
let client: Client;
let admin: TestUser;
let bob: TestUser;
let project: SeedResult;
let otherProject: SeedResult;
let importedSchemeId: string;
let importedGrantId: string;
let copiedSchemeId: string;
let localGrantId: string;
let groupId: string;
let createdGlobalScheme = false;

function swapSelect(next: typeof db.select) {
	const target = db as unknown as { select: typeof db.select };
	const previous = target.select;
	target.select = next;
	return () => {
		target.select = previous;
	};
}

function jiraClient(): PermissionImportClient {
	return {
		async getJson<T>(
			path: string,
			params?: Record<string, string | number | boolean | undefined>,
		) {
			if (path === "/rest/api/2/groups/picker") {
				return { groups: [], total: 0 } as T;
			}
			if (path === `/rest/api/2/project/${projectKey}/role`) {
				return {} as T;
			}
			if (path === `/rest/api/2/project/${projectKey}/permissionscheme`) {
				return {
					id: schemeSource,
					name: `Imported scheme ${run}`,
					description: "Imported scheme",
					permissions: [
						{
							id: 1,
							permission: "EDIT_ISSUES",
							holder: { type: "projectRole", parameter: "member" },
						},
					],
				} as T;
			}
			throw new Error(
				`unexpected Jira path ${path} ${JSON.stringify(params ?? {})}`,
			);
		},
	};
}

async function schemeDetail(id: string) {
	return injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/permission-schemes/${id}`,
	);
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	admin = await makeUser(run, "admin", { admin: true });
	bob = await makeUser(run, "bob");

	project = await createProjectFixture(client, {
		run,
		key: projectKey,
		name: `Scheme project ${run}`,
		issues: [{ summary: `Scheme issue ${run}` }],
	});
	otherProject = await createProjectFixture(client, {
		run: `${run}b`,
		key: otherKey,
		name: `Other scheme project ${run}`,
		issues: [{ summary: `Other issue ${run}` }],
	});

	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: schemeSource,
			name: `Imported scheme ${run}`,
			description: "Imported scheme",
			projectIds: [project.projectId],
			raw: { fixture: true },
		})
		.returning({ id: permissionSchemes.id });
	importedSchemeId = scheme.id;
	const grants = await db
		.insert(permissionGrants)
		.values([
			{
				sourceId: `${schemeSource}:browse`,
				schemeId: importedSchemeId,
				permissionKey: "BROWSE_PROJECTS",
				holderType: "projectRole",
				holderParameter: "member",
				raw: {},
			},
			{
				sourceId: importedGrantSource(importedSchemeId),
				schemeId: importedSchemeId,
				permissionKey: "EDIT_ISSUES",
				holderType: "projectRole",
				holderParameter: "member",
				raw: {},
			},
		])
		.returning({ id: permissionGrants.id });
	importedGrantId = grants[1].id;

	const [group] = await db
		.insert(groups)
		.values({ name: groupName, local: true })
		.returning({ id: groups.id });
	groupId = group.id;

	const existingGlobal = await db
		.select({ id: permissionSchemes.id })
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, "global"))
		.limit(1);
	createdGlobalScheme = existingGlobal.length === 0;
});

afterAll(async () => {
	if (client) {
		await client.query("delete from audit_log where actor_id = $1", [admin.id]);
		await client.query(
			"delete from permission_local_removals where source_id = any($1)",
			[[importedGrantSource(importedSchemeId)]],
		);
		await client.query(
			"delete from permission_grants where scheme_id = any($1::uuid[])",
			[[importedSchemeId, copiedSchemeId]],
		);
		await client.query(
			"delete from permission_schemes where id = any($1::uuid[])",
			[[importedSchemeId, copiedSchemeId]],
		);
		await client.query(
			"delete from permission_local_assignments where project_id = any($1::uuid[])",
			[[project.projectId, otherProject.projectId]],
		);
		await client.query(
			`delete from permission_grants
			 where scheme_id in (select id from permission_schemes where source_id = 'global')
			   and holder_parameter = any($1)`,
			[[bob.username, groupName]],
		);
		await client.query("delete from groups where id = $1", [groupId]);
		await client.query("delete from users where id = $1", [bob.id]);
		await dropProjectFixture(client, run);
		await dropProjectFixture(client, `${run}b`);
		if (createdGlobalScheme) {
			await client.query(
				"delete from permission_grants where scheme_id in (select id from permission_schemes where source_id = 'global')",
			);
			await client.query(
				"delete from permission_schemes where source_id = 'global'",
			);
		}
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("lists schemes with their projects and shows the grant table", async () => {
	const list = await injectAs(
		app,
		admin.session,
		"GET",
		"/api/admin/permission-schemes",
	);
	expect(list.statusCode).toBe(200);
	const schemes = list.json().schemes as {
		id: string;
		sourceId: string;
		projects: { id: string }[];
	}[];
	expect(schemes.some((scheme) => scheme.sourceId === "global")).toBe(false);
	expect(schemes).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: importedSchemeId,
				source: "imported",
				projects: expect.arrayContaining([
					expect.objectContaining({ id: project.projectId, key: projectKey }),
				]),
			}),
		]),
	);

	const detail = await schemeDetail(importedSchemeId);
	expect(detail.statusCode).toBe(200);
	const body = detail.json();
	expect(body.grants).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				permissionKey: "BROWSE_PROJECTS",
				holderType: "projectRole",
				holderParameter: "member",
				source: "imported",
			}),
		]),
	);
	expect(body.permissionKeys).toContain("ADMINISTER_PROJECTS");
	expect(body.roles).toEqual(
		expect.arrayContaining([expect.objectContaining({ id: "member" })]),
	);

	const missing = await schemeDetail("00000000-0000-0000-0000-000000000000");
	expect(missing.statusCode).toBe(404);
});

test("copies a scheme into a local scheme with local grants", async () => {
	const copied = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${importedSchemeId}/copy`,
		{ name: `Copied scheme ${run}` },
	);
	expect(copied.statusCode).toBe(201);
	const scheme = copied.json().scheme;
	copiedSchemeId = scheme.id;
	expect(scheme).toMatchObject({
		name: `Copied scheme ${run}`,
		source: "local",
		projects: [],
	});
	expect(scheme.sourceId.startsWith("local:")).toBe(true);

	const detail = await schemeDetail(copiedSchemeId);
	expect(detail.json().grants).toHaveLength(2);
	expect(
		(detail.json().grants as { source: string }[]).every(
			(grant) => grant.source === "local",
		),
	).toBe(true);

	const audits = await db
		.select({ action: auditLog.action })
		.from(auditLog)
		.where(eq(auditLog.entityId, copiedSchemeId));
	expect(audits.map((row) => row.action)).toContain("permission.scheme.copy");
});

test("adds and removes a grant, and an imported scheme stays editable", async () => {
	const added = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${copiedSchemeId}/grants`,
		{
			permissionKey: "ASSIGN_ISSUES",
			holderType: "projectRole",
			holderParameter: "member",
		},
	);
	expect(added.statusCode).toBe(201);
	localGrantId = added.json().grant.id;
	expect(added.json().grant).toMatchObject({
		permissionKey: "ASSIGN_ISSUES",
		holderType: "projectRole",
		holderParameter: "member",
		source: "local",
	});

	const duplicate = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${copiedSchemeId}/grants`,
		{
			permissionKey: "ASSIGN_ISSUES",
			holderType: "projectRole",
			holderParameter: "MEMBER",
		},
	);
	expect(duplicate.statusCode).toBe(409);

	const missingHolder = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${copiedSchemeId}/grants`,
		{ permissionKey: "EDIT_ISSUES", holderType: "user" },
	);
	expect(missingHolder.statusCode).toBe(400);

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/permission-schemes/${copiedSchemeId}/grants/${localGrantId}`,
	);
	expect(removed.statusCode).toBe(204);
	const detail = await schemeDetail(copiedSchemeId);
	expect(detail.json().grants).toHaveLength(2);

	const removedImported = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/permission-schemes/${importedSchemeId}/grants/${importedGrantId}`,
	);
	expect(removedImported.statusCode).toBe(204);
	const tombstones = await db
		.select({ sourceId: permissionLocalRemovals.sourceId })
		.from(permissionLocalRemovals);
	expect(
		tombstones.some(
			(row) => row.sourceId === importedGrantSource(importedSchemeId),
		),
	).toBe(true);
});

test("a project role grant must name a real role", async () => {
	const url = `/api/admin/permission-schemes/${copiedSchemeId}/grants`;
	const missing = await injectAs(app, admin.session, "POST", url, {
		permissionKey: "ASSIGN_ISSUES",
		holderType: "projectRole",
		holderParameter: "not-a-role",
	});
	expect(missing.statusCode).toBe(404);

	const added = await injectAs(app, admin.session, "POST", url, {
		permissionKey: "ASSIGN_ISSUES",
		holderType: "projectRole",
		holderParameter: "MEMBER",
	});
	expect(added.statusCode).toBe(201);
	expect(added.json().grant.holderParameter).toBe("member");

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`${url}/${added.json().grant.id}`,
	);
	expect(removed.statusCode).toBe(204);

	const roleId = `20001-${run}`;
	const roleNames = ["Alpha Role", "Beta Role", "Gamma Role"];
	const actorSources = roleNames.map((_, index) => `test:${run}:role:${index}`);
	await db.insert(projectRoleActors).values(
		roleNames.map((roleName, index) => ({
			sourceId: actorSources[index],
			projectId: index === 1 ? otherProject.projectId : project.projectId,
			roleId,
			roleName,
			actorType: "user",
			actorParameter: index === 2 ? admin.username : bob.username,
			raw: {},
		})),
	);
	try {
		const detail = await schemeDetail(copiedSchemeId);
		const listed = (detail.json().roles as { id: string; name: string }[])
			.filter((role) => role.id === roleId)
			.map((role) => role.name);
		const missingName = roleNames.find((name) => !listed.includes(name));
		expect(missingName).toBeDefined();
		const resolved = await injectAs(app, admin.session, "POST", url, {
			permissionKey: "LINK_ISSUES",
			holderType: "projectRole",
			holderParameter: missingName,
		});
		expect(resolved.statusCode).toBe(201);
		expect(resolved.json().grant.holderParameter).toBe(roleId);
		await injectAs(
			app,
			admin.session,
			"DELETE",
			`${url}/${resolved.json().grant.id}`,
		);
	} finally {
		await db
			.delete(projectRoleActors)
			.where(inArray(projectRoleActors.sourceId, actorSources));
	}
});

test("built-in role ids win over an imported role with the same name", async () => {
	const url = `/api/admin/permission-schemes/${copiedSchemeId}/grants`;
	const roleId = `10001-${run}`;
	const actorSource = `test:${run}:role-collision`;
	await db.insert(projectRoleActors).values({
		sourceId: actorSource,
		projectId: otherProject.projectId,
		roleId,
		roleName: "Member",
		actorType: "user",
		actorParameter: bob.username,
		raw: {},
	});
	const grants: string[] = [];
	try {
		const builtin = await injectAs(app, admin.session, "POST", url, {
			permissionKey: "CREATE_ISSUES",
			holderType: "projectRole",
			holderParameter: "MEMBER",
		});
		expect(builtin.statusCode).toBe(201);
		expect(builtin.json().grant.holderParameter).toBe("member");
		grants.push(builtin.json().grant.id);

		const exact = await injectAs(app, admin.session, "POST", url, {
			permissionKey: "DELETE_ISSUES",
			holderType: "projectRole",
			holderParameter: roleId.toUpperCase(),
		});
		expect(exact.statusCode).toBe(201);
		expect(exact.json().grant.holderParameter).toBe(roleId);
		grants.push(exact.json().grant.id);
	} finally {
		if (grants.length > 0) {
			await db
				.delete(permissionGrants)
				.where(inArray(permissionGrants.id, grants));
		}
		await db
			.delete(projectRoleActors)
			.where(eq(projectRoleActors.sourceId, actorSource));
	}
});

test("concurrent identical grants create one grant", async () => {
	const url = `/api/admin/permission-schemes/${importedSchemeId}/grants`;
	const body = {
		permissionKey: "LINK_ISSUES",
		holderType: "applicationRole",
	};
	const original = db.transaction.bind(db);
	let entered = 0;
	let release = () => {};
	let bothEntered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const both = new Promise<void>((resolve) => {
		bothEntered = resolve;
	});
	const restore = swapTransaction(async (callback) => {
		entered += 1;
		if (entered === 2) bothEntered();
		await gate;
		return original(callback);
	});
	try {
		const request = () => injectAs(app, admin.session, "POST", url, body);
		const first = request();
		const second = request();
		await both;
		restore();
		release();
		const responses = await Promise.all([first, second]);
		expect(responses.map((response) => response.statusCode).sort()).toEqual([
			201, 409,
		]);
		const grants = await db
			.select({ id: permissionGrants.id })
			.from(permissionGrants)
			.where(
				and(
					eq(permissionGrants.schemeId, importedSchemeId),
					eq(permissionGrants.permissionKey, "LINK_ISSUES"),
					eq(permissionGrants.holderType, "applicationRole"),
				),
			);
		expect(grants).toHaveLength(1);
		if (grants[0]) {
			await db
				.delete(permissionGrants)
				.where(eq(permissionGrants.id, grants[0].id));
		}
	} finally {
		restore();
		release();
	}
});

test("an application role grant, as the Jira import writes it, can be added again", async () => {
	const url = `/api/admin/permission-schemes/${copiedSchemeId}/grants`;
	const body = { permissionKey: "ADD_COMMENTS", holderType: "applicationRole" };
	const added = await injectAs(app, admin.session, "POST", url, body);
	expect(added.statusCode).toBe(201);
	expect(added.json().grant).toMatchObject({
		holderType: "applicationRole",
		holderParameter: null,
		source: "local",
	});
	expect(
		(await injectAs(app, admin.session, "POST", url, body)).statusCode,
	).toBe(409);
	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`${url}/${added.json().grant.id}`,
	);
	expect(removed.statusCode).toBe(204);
});

test("assigns a scheme to a project and the assignment survives a re-import", async () => {
	const assigned = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${importedSchemeId}/projects`,
		{ projectId: otherProject.projectId },
	);
	expect(assigned.statusCode).toBe(200);
	expect(assigned.json().scheme.projects).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: project.projectId }),
			expect.objectContaining({ id: otherProject.projectId }),
		]),
	);

	const assignment = await db
		.select()
		.from(permissionLocalAssignments)
		.where(eq(permissionLocalAssignments.projectId, otherProject.projectId));
	expect(assignment).toHaveLength(1);
	expect(assignment[0]?.schemeId).toBe(importedSchemeId);

	const localGrant = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${importedSchemeId}/grants`,
		{
			permissionKey: "CREATE_ISSUES",
			holderType: "group",
			holderParameter: groupName,
		},
	);
	expect(localGrant.statusCode).toBe(201);

	await importPermissions(jiraClient(), {
		projectKeys: [projectKey],
		fullImport: true,
		fetchGlobal: false,
	});

	const [scheme] = await db
		.select()
		.from(permissionSchemes)
		.where(eq(permissionSchemes.id, importedSchemeId));
	expect(scheme.projectIds).toEqual(
		expect.arrayContaining([project.projectId, otherProject.projectId]),
	);
	const grants = await db
		.select({
			permissionKey: permissionGrants.permissionKey,
			sourceId: permissionGrants.sourceId,
		})
		.from(permissionGrants)
		.where(eq(permissionGrants.schemeId, importedSchemeId));
	expect(grants.some((grant) => grant.sourceId.startsWith("local:"))).toBe(
		true,
	);
	expect(
		grants.some(
			(grant) => grant.sourceId === importedGrantSource(importedSchemeId),
		),
	).toBe(false);
});

test("global ADMINISTER holders can be added and removed", async () => {
	const before = await injectAs(
		app,
		admin.session,
		"GET",
		"/api/admin/global-permissions",
	);
	expect(before.statusCode).toBe(200);

	const added = await injectAs(
		app,
		admin.session,
		"POST",
		"/api/admin/global-permissions",
		{ holderType: "user", holderParameter: bob.username },
	);
	expect(added.statusCode).toBe(201);
	const holderId = added.json().holder.id;
	expect(added.json().holder).toMatchObject({
		holderType: "user",
		holderParameter: bob.username,
		source: "local",
	});

	const duplicate = await injectAs(
		app,
		admin.session,
		"POST",
		"/api/admin/global-permissions",
		{ holderType: "user", holderParameter: bob.username.toUpperCase() },
	);
	expect(duplicate.statusCode).toBe(200);
	expect(duplicate.json().holder.id).toBe(holderId);

	const withHolder = await injectAs(
		app,
		admin.session,
		"GET",
		"/api/admin/global-permissions",
	);
	expect(withHolder.json().holders).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: holderId, holderParameter: bob.username }),
		]),
	);

	const asAdmin = await injectAs(
		app,
		bob.session,
		"GET",
		`/api/projects/${projectKey}/roles`,
	);
	expect(asAdmin.statusCode).toBe(200);

	const groupHolder = await injectAs(
		app,
		admin.session,
		"POST",
		"/api/admin/global-permissions",
		{ holderType: "group", holderParameter: groupName },
	);
	expect(groupHolder.statusCode).toBe(201);

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/global-permissions/${holderId}`,
	);
	expect(removed.statusCode).toBe(204);
	const after = await injectAs(
		app,
		admin.session,
		"GET",
		"/api/admin/global-permissions",
	);
	expect(
		(after.json().holders as { id: string }[]).some(
			(holder) => holder.id === holderId,
		),
	).toBe(false);

	const asNonAdmin = await injectAs(
		app,
		bob.session,
		"GET",
		`/api/projects/${projectKey}/roles`,
	);
	expect(asNonAdmin.statusCode).toBe(404);

	await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/global-permissions/${groupHolder.json().holder.id}`,
	);

	const audits = await db
		.select({ action: auditLog.action })
		.from(auditLog)
		.where(eq(auditLog.actorId, admin.id));
	expect(audits.map((row) => row.action)).toEqual(
		expect.arrayContaining([
			"global.permission.add",
			"global.permission.remove",
		]),
	);
});

test("only user and group global holders can be removed", async () => {
	await db
		.insert(permissionSchemes)
		.values({
			sourceId: "global",
			name: "Global permissions",
			description: "Global permission holders imported from Jira",
			projectIds: [],
			raw: {},
		})
		.onConflictDoNothing();
	const [scheme] = await db
		.select({ id: permissionSchemes.id })
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, "global"));
	const [grant] = await db
		.insert(permissionGrants)
		.values({
			sourceId: `test:${run}:global-project-role`,
			schemeId: scheme.id,
			permissionKey: "ADMINISTER",
			holderType: "projectRole",
			holderParameter: "member",
			raw: {},
		})
		.returning({ id: permissionGrants.id });
	try {
		const removed = await injectAs(
			app,
			admin.session,
			"DELETE",
			`/api/admin/global-permissions/${grant.id}`,
		);
		expect(removed.statusCode).toBe(404);
		const rows = await db
			.select({ id: permissionGrants.id })
			.from(permissionGrants)
			.where(eq(permissionGrants.id, grant.id));
		expect(rows).toHaveLength(1);
	} finally {
		await db.delete(permissionGrants).where(eq(permissionGrants.id, grant.id));
	}
});

test("concurrent global permission removals audit once", async () => {
	const dave = await makeUser(run, "dave");
	const added = await injectAs(
		app,
		admin.session,
		"POST",
		"/api/admin/global-permissions",
		{ holderType: "user", holderParameter: dave.username },
	);
	expect(added.statusCode).toBe(201);
	const holderId = added.json().holder.id;

	const original = db.transaction.bind(db);
	let entered = 0;
	let release = () => {};
	let bothEntered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const both = new Promise<void>((resolve) => {
		bothEntered = resolve;
	});
	const restore = swapTransaction(async (callback) => {
		entered += 1;
		if (entered === 2) bothEntered();
		await gate;
		return original(callback);
	});
	try {
		const request = () =>
			injectAs(
				app,
				admin.session,
				"DELETE",
				`/api/admin/global-permissions/${holderId}`,
			);
		const first = request();
		const second = request();
		await both;
		restore();
		release();
		const responses = await Promise.all([first, second]);
		expect(responses.map((response) => response.statusCode).sort()).toEqual([
			204, 404,
		]);
		const audits = await db
			.select({ id: auditLog.id })
			.from(auditLog)
			.where(
				and(
					eq(auditLog.action, "global.permission.remove"),
					sql`${auditLog.summary} like ${`%${dave.username}%`}`,
				),
			);
		expect(audits).toHaveLength(1);
	} finally {
		restore();
		release();
	}
});

test("concurrent identical global grants create one holder", async () => {
	const carol = await makeUser(run, "carol");
	const original = db.transaction.bind(db);
	let entered = 0;
	let release = () => {};
	let bothEntered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const both = new Promise<void>((resolve) => {
		bothEntered = resolve;
	});
	const restore = swapTransaction(async (callback) => {
		entered += 1;
		if (entered === 2) bothEntered();
		await gate;
		return original(callback);
	});
	const request = () =>
		injectAs(app, admin.session, "POST", "/api/admin/global-permissions", {
			holderType: "user",
			holderParameter: carol.username,
		});
	const first = request();
	const second = request();
	await both;
	restore();
	release();

	const responses = await Promise.all([first, second]);
	expect(responses.map((response) => response.statusCode).sort()).toEqual([
		200, 201,
	]);
	const [scheme] = await db
		.select({ id: permissionSchemes.id })
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, "global"));
	expect(scheme).toBeDefined();
	const grants = await db
		.select({ id: permissionGrants.id })
		.from(permissionGrants)
		.where(
			and(
				eq(permissionGrants.schemeId, scheme.id),
				eq(permissionGrants.permissionKey, "ADMINISTER"),
				sql`lower(${permissionGrants.holderParameter}) = ${carol.username.toLowerCase()}`,
			),
		);
	expect(grants).toHaveLength(1);
	const audits = await db
		.select({ id: auditLog.id })
		.from(auditLog)
		.where(
			and(
				eq(auditLog.action, "global.permission.add"),
				eq(auditLog.entityId, scheme.id),
				sql`${auditLog.summary} like ${`%${carol.username}%`}`,
			),
		);
	expect(audits).toHaveLength(1);
	await db
		.delete(permissionGrants)
		.where(eq(permissionGrants.id, grants[0].id));
});

test("a non-admin cannot open the admin permission screens", async () => {
	const response = await injectAs(
		app,
		bob.session,
		"GET",
		"/api/admin/permission-schemes",
	);
	expect(response.statusCode).toBe(403);
	const global = await injectAs(
		app,
		bob.session,
		"GET",
		"/api/admin/global-permissions",
	);
	expect(global.statusCode).toBe(403);
});

test("removes a project from a scheme and the built-in default applies again", async () => {
	const assigned = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${importedSchemeId}/projects`,
		{ projectId: otherProject.projectId },
	);
	expect(assigned.statusCode).toBe(200);

	const denied = await injectAs(
		app,
		bob.session,
		"DELETE",
		`/api/admin/permission-schemes/${importedSchemeId}/projects/${otherProject.projectId}`,
	);
	expect(denied.statusCode).toBe(403);

	const missingScheme = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/permission-schemes/00000000-0000-0000-0000-000000000000/projects/${otherProject.projectId}`,
	);
	expect(missingScheme.statusCode).toBe(404);

	const hiddenBefore = await injectAs(
		app,
		bob.session,
		"GET",
		`/projects/${otherKey}/issues`,
	);
	expect(hiddenBefore.statusCode).toBe(404);

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/permission-schemes/${importedSchemeId}/projects/${otherProject.projectId}`,
	);
	expect(removed.statusCode).toBe(204);

	const detail = await schemeDetail(importedSchemeId);
	expect(detail.json().scheme.projects).not.toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: otherProject.projectId }),
		]),
	);
	const again = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/permission-schemes/${importedSchemeId}/projects/${otherProject.projectId}`,
	);
	expect(again.statusCode).toBe(404);

	const assignments = await db
		.select({ schemeId: permissionLocalAssignments.schemeId })
		.from(permissionLocalAssignments)
		.where(eq(permissionLocalAssignments.projectId, otherProject.projectId));
	expect(assignments.some((row) => row.schemeId === importedSchemeId)).toBe(
		false,
	);

	const visibleAgain = await injectAs(
		app,
		bob.session,
		"GET",
		`/projects/${otherKey}/issues`,
	);
	expect(visibleAgain.statusCode).toBe(200);

	const audits = await db
		.select({ action: auditLog.action })
		.from(auditLog)
		.where(eq(auditLog.entityId, importedSchemeId));
	expect(audits.map((row) => row.action)).toContain(
		"permission.scheme.unassign",
	);
});

test("an assigned scheme reads its projects inside the deletion transaction", async () => {
	const assigned = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${copiedSchemeId}/projects`,
		{ projectId: otherProject.projectId },
	);
	expect(assigned.statusCode).toBe(200);

	const originalTransaction = db.transaction.bind(db);
	const originalSelect = db.select.bind(db);
	let inTransaction = false;
	const restoreTransaction = swapTransaction(async (callback) => {
		inTransaction = true;
		try {
			return await originalTransaction(callback);
		} finally {
			inTransaction = false;
		}
	});
	const restoreSelect = swapSelect(((...args: Parameters<typeof db.select>) => {
		if (inTransaction) {
			throw new Error("read outside the deletion transaction");
		}
		return originalSelect(...args);
	}) as typeof db.select);
	try {
		const blocked = await injectAs(
			app,
			admin.session,
			"DELETE",
			`/api/admin/permission-schemes/${copiedSchemeId}`,
		);
		expect(blocked.statusCode).toBe(409);
		expect(blocked.json().error).toContain("Remove the project");
	} finally {
		restoreSelect();
		restoreTransaction();
	}
});

test("deletes a scheme only after its projects are removed", async () => {
	const assigned = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${copiedSchemeId}/projects`,
		{ projectId: otherProject.projectId },
	);
	expect(assigned.statusCode).toBe(200);

	const blocked = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/permission-schemes/${copiedSchemeId}`,
	);
	expect(blocked.statusCode).toBe(409);
	expect(blocked.json().error).toContain("Remove the project");

	const denied = await injectAs(
		app,
		bob.session,
		"DELETE",
		`/api/admin/permission-schemes/${copiedSchemeId}`,
	);
	expect(denied.statusCode).toBe(403);

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/permission-schemes/${copiedSchemeId}/projects/${otherProject.projectId}`,
	);
	expect(removed.statusCode).toBe(204);

	const missing = await injectAs(
		app,
		admin.session,
		"DELETE",
		"/api/admin/permission-schemes/00000000-0000-0000-0000-000000000000",
	);
	expect(missing.statusCode).toBe(404);

	const deleted = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/permission-schemes/${copiedSchemeId}`,
	);
	expect(deleted.statusCode).toBe(204);
	expect((await schemeDetail(copiedSchemeId)).statusCode).toBe(404);

	const grants = await db
		.select({ id: permissionGrants.id })
		.from(permissionGrants)
		.where(eq(permissionGrants.schemeId, copiedSchemeId));
	expect(grants).toEqual([]);

	const audits = await db
		.select({ action: auditLog.action })
		.from(auditLog)
		.where(eq(auditLog.entityId, copiedSchemeId));
	expect(audits.map((row) => row.action)).toContain("permission.scheme.delete");
});
test("deleting a scheme waits for a concurrent assignment", async () => {
	const [local] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `test:${run}:delete-race`,
			name: `Delete race ${run}`,
			projectIds: [],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	const original = db.transaction.bind(db);
	let release = () => {};
	let entered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const restore = swapTransaction(async (callback) => {
		entered();
		await gate;
		return original(callback);
	});
	try {
		const removal = injectAs(
			app,
			admin.session,
			"DELETE",
			`/api/admin/permission-schemes/${local.id}`,
		);
		await started;
		restore();
		const assigned = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/permission-schemes/${local.id}/projects`,
			{ projectId: otherProject.projectId },
		);
		expect(assigned.statusCode).toBe(200);
		release();
		const removed = await removal;
		expect(removed.statusCode).toBe(409);

		const rows = await db
			.select({ id: permissionSchemes.id })
			.from(permissionSchemes)
			.where(eq(permissionSchemes.id, local.id));
		expect(rows).toHaveLength(1);
		const assignments = await db
			.select({ schemeId: permissionLocalAssignments.schemeId })
			.from(permissionLocalAssignments)
			.where(eq(permissionLocalAssignments.projectId, otherProject.projectId));
		expect(assignments.some((row) => row.schemeId === local.id)).toBe(true);
	} finally {
		restore();
		release();
		await injectAs(
			app,
			admin.session,
			"DELETE",
			`/api/admin/permission-schemes/${local.id}/projects/${otherProject.projectId}`,
		);
		await injectAs(
			app,
			admin.session,
			"DELETE",
			`/api/admin/permission-schemes/${local.id}`,
		);
	}
});

test("assigning a project leaves the global scheme untouched", async () => {
	let [global] = await db
		.select({
			id: permissionSchemes.id,
			projectIds: permissionSchemes.projectIds,
		})
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, "global"));
	if (!global) {
		await db
			.insert(permissionSchemes)
			.values({
				sourceId: "global",
				name: "Global permissions",
				description: "Global permission holders imported from Jira",
				projectIds: [],
				raw: {},
			})
			.onConflictDoNothing();
		[global] = await db
			.select({
				id: permissionSchemes.id,
				projectIds: permissionSchemes.projectIds,
			})
			.from(permissionSchemes)
			.where(eq(permissionSchemes.sourceId, "global"));
	}
	expect(global).toBeDefined();
	const original = global.projectIds ?? [];
	await db
		.update(permissionSchemes)
		.set({ projectIds: [otherProject.projectId] })
		.where(eq(permissionSchemes.id, global.id));
	let assigned = false;
	try {
		const response = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/permission-schemes/${importedSchemeId}/projects`,
			{ projectId: otherProject.projectId },
		);
		expect(response.statusCode).toBe(200);
		assigned = true;
		const [after] = await db
			.select({ projectIds: permissionSchemes.projectIds })
			.from(permissionSchemes)
			.where(eq(permissionSchemes.id, global.id));
		expect(after.projectIds).toContain(otherProject.projectId);
	} finally {
		await db
			.update(permissionSchemes)
			.set({ projectIds: original })
			.where(eq(permissionSchemes.id, global.id));
		if (assigned) {
			await injectAs(
				app,
				admin.session,
				"DELETE",
				`/api/admin/permission-schemes/${importedSchemeId}/projects/${otherProject.projectId}`,
			);
		}
	}
});
test("concurrent assignments keep both projects assigned", async () => {
	const [local] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `test:${run}:concurrent-local`,
			name: `Concurrent local ${run}`,
			projectIds: [],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	const original = db.transaction.bind(db);
	let release = () => {};
	let entered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const restore = swapTransaction(async (callback) => {
		entered();
		await gate;
		return original(callback);
	});
	try {
		const first = injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/permission-schemes/${importedSchemeId}/projects`,
			{ projectId: otherProject.projectId },
		);
		await started;
		restore();
		const second = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/permission-schemes/${local.id}/projects`,
			{ projectId: project.projectId },
		);
		expect(second.statusCode).toBe(200);
		release();
		const firstResponse = await first;
		expect(firstResponse.statusCode).toBe(200);

		const rows = await db
			.select({
				id: permissionSchemes.id,
				projectIds: permissionSchemes.projectIds,
			})
			.from(permissionSchemes)
			.where(eq(permissionSchemes.sourceId, `test:${run}:concurrent-local`));
		const [imported] = await db
			.select({ projectIds: permissionSchemes.projectIds })
			.from(permissionSchemes)
			.where(eq(permissionSchemes.id, importedSchemeId));
		expect(imported.projectIds).toContain(otherProject.projectId);
		expect(imported.projectIds).not.toContain(project.projectId);
		expect(rows[0]?.projectIds).toContain(project.projectId);
		expect(rows[0]?.projectIds).not.toContain(otherProject.projectId);
	} finally {
		restore();
		await db
			.delete(permissionSchemes)
			.where(eq(permissionSchemes.id, local.id));
	}
});
test("a removal does not overwrite a concurrent assignment", async () => {
	const [local] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `test:${run}:removal-local`,
			name: `Removal local ${run}`,
			projectIds: [],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	await db
		.update(permissionSchemes)
		.set({ projectIds: [project.projectId, otherProject.projectId] })
		.where(eq(permissionSchemes.id, importedSchemeId));
	const original = db.transaction.bind(db);
	let release = () => {};
	let entered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const restore = swapTransaction(async (callback) => {
		entered();
		await gate;
		return original(callback);
	});
	try {
		const removal = injectAs(
			app,
			admin.session,
			"DELETE",
			`/api/admin/permission-schemes/${importedSchemeId}/projects/${project.projectId}`,
		);
		await started;
		restore();
		const assigned = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/permission-schemes/${local.id}/projects`,
			{ projectId: otherProject.projectId },
		);
		expect(assigned.statusCode).toBe(200);
		release();
		const removed = await removal;
		expect(removed.statusCode).toBe(204);

		const [imported] = await db
			.select({ projectIds: permissionSchemes.projectIds })
			.from(permissionSchemes)
			.where(eq(permissionSchemes.id, importedSchemeId));
		const [localRow] = await db
			.select({ projectIds: permissionSchemes.projectIds })
			.from(permissionSchemes)
			.where(eq(permissionSchemes.id, local.id));
		expect(imported.projectIds).toEqual([]);
		expect(localRow.projectIds).toEqual([otherProject.projectId]);
	} finally {
		restore();
		await db
			.delete(permissionSchemes)
			.where(eq(permissionSchemes.id, local.id));
	}
});
