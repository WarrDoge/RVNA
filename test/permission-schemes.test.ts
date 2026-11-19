import { eq } from "drizzle-orm";
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
} from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
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
