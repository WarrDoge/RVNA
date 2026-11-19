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
	permissionLocalRemovals,
	permissionSchemes,
	projectRoleActors,
	userGroups,
	users,
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
const importedKey = `IR${run.slice(0, 5).toUpperCase()}`;
const groupName = `t-${run}-team`;
const importedGroup = `t-${run}-jira-team`;
const schemeSource = `test:${run}:scheme`;
const importedSchemeSource = `test:${run}:imported-scheme`;
const base = "https://jira.example.test";
const issueSummary = `Project role issue ${run}`;

let app: TestApp;
let client: Client;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let project: SeedResult;
let importedProject: SeedResult;
let schemeId: string;
let localGroupId: string;
let fixtureReporterId: string;

function jiraClient(): PermissionImportClient {
	return {
		async getJson<T>(path: string) {
			if (path === "/rest/api/2/groups/picker") {
				return {
					groups: [{ name: importedGroup, groupId: "1" }],
					total: 1,
				} as T;
			}
			if (path === "/rest/api/2/group/member") {
				return {
					values: [{ name: `t-${run}-fixture` }],
					isLast: true,
				} as T;
			}
			if (path === `/rest/api/2/project/${importedKey}/role`) {
				return {
					Developers: `${base}/rest/api/2/project/${importedKey}/role/10001`,
				} as T;
			}
			if (path.endsWith("/role/10001")) {
				return {
					id: 10001,
					name: "Developers",
					actors: [
						{
							id: 2,
							displayName: "Fixture Reporter",
							type: "atlassian-user-role-actor",
							name: `t-${run}-fixture`,
						},
					],
				} as T;
			}
			if (path === `/rest/api/2/project/${importedKey}/permissionscheme`) {
				return {
					id: importedSchemeSource,
					name: `Imported scheme ${run}`,
					permissions: [
						{
							id: 1,
							permission: "BROWSE_PROJECTS",
							holder: { type: "projectRole", parameter: "10001" },
						},
					],
				} as T;
			}
			throw new Error(`unexpected Jira path ${path}`);
		},
	};
}

async function rolesFor(user: TestUser) {
	return injectAs(
		app,
		user.session,
		"GET",
		`/api/projects/${projectKey}/roles`,
	);
}

async function importedRoles() {
	return injectAs(
		app,
		admin.session,
		"GET",
		`/api/projects/${importedKey}/roles`,
	);
}

function findRole(
	body: {
		roles: {
			id: string;
			name: string;
			actors: { id: string; parameter: string; source: string }[];
			permissions: string[];
		}[];
	},
	roleId: string,
) {
	return body.roles.find(
		(role) =>
			role.id.toLowerCase() === roleId.toLowerCase() ||
			role.name.toLowerCase() === roleId.toLowerCase(),
	);
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	admin = await makeUser(run, "admin", { admin: true });
	alice = await makeUser(run, "alice");
	bob = await makeUser(run, "bob");

	project = await createProjectFixture(client, {
		run,
		key: projectKey,
		name: `Project roles ${run}`,
		issues: [{ summary: issueSummary }],
	});
	importedProject = await createProjectFixture(client, {
		run: `${run}imp`,
		key: importedKey,
		name: `Imported roles ${run}`,
		issues: [{ summary: `Imported issue ${run}` }],
	});

	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: schemeSource,
			name: `Project roles scheme ${run}`,
			projectIds: [project.projectId],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	schemeId = scheme.id;
	await db.insert(permissionGrants).values([
		{
			sourceId: `${schemeSource}:browse`,
			schemeId,
			permissionKey: "BROWSE_PROJECTS",
			holderType: "projectRole",
			holderParameter: "viewer",
			raw: {},
		},
	]);

	const [group] = await db
		.insert(groups)
		.values({ name: groupName, local: true })
		.returning({ id: groups.id });
	localGroupId = group.id;

	const [reporter] = await db
		.insert(users)
		.values({
			sourceKey: `${run}:fixture-reporter`,
			username: `t-${run}-fixture`,
			displayName: "Fixture Reporter",
		})
		.returning({ id: users.id });
	fixtureReporterId = reporter.id;
});

afterAll(async () => {
	if (client) {
		await client.query(
			"delete from audit_log where actor_id = any($1::uuid[])",
			[[admin.id, alice.id, bob.id]],
		);
		await client.query(
			"delete from permission_grants where scheme_id = any($1::uuid[])",
			[[schemeId]],
		);
		await client.query("delete from permission_schemes where source_id = $1", [
			schemeSource,
		]);
		const importedSchemes = await client.query<{ id: string }>(
			"select id from permission_schemes where source_id = $1",
			[importedSchemeSource],
		);
		for (const row of importedSchemes.rows) {
			await client.query(
				"delete from permission_local_removals where source_id in (select source_id from permission_grants where scheme_id = $1)",
				[row.id],
			);
			await client.query("delete from permission_grants where scheme_id = $1", [
				row.id,
			]);
		}
		await client.query("delete from permission_schemes where source_id = $1", [
			importedSchemeSource,
		]);
		await client.query(
			"delete from permission_local_removals where source_id like $1",
			[`jira:${importedKey}:%`],
		);
		await client.query("delete from groups where name = any($1)", [
			[groupName, importedGroup],
		]);
		await dropProjectFixture(client, run);
		await dropProjectFixture(client, `${run}imp`);
		await client.query("delete from users where id = $1", [fixtureReporterId]);
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("lists the roles of the scheme and guards the project", async () => {
	const adminRoles = await rolesFor(admin);
	expect(adminRoles.statusCode).toBe(200);
	const body = adminRoles.json();
	expect(body.scheme).toMatchObject({
		id: schemeId,
		name: `Project roles scheme ${run}`,
		source: "imported",
	});
	const viewer = findRole(body, "viewer");
	expect(viewer).toBeDefined();
	expect(viewer?.permissions).toEqual(["BROWSE_PROJECTS"]);
	expect(viewer?.actors).toEqual([]);
	expect(body.groups).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: localGroupId, name: groupName }),
		]),
	);

	const noAccess = await rolesFor(bob);
	expect(noAccess.statusCode).toBe(404);
	expect(noAccess.json().error).toBe("Project not found");

	const missing = await injectAs(
		app,
		admin.session,
		"GET",
		"/api/projects/NOPE/roles",
	);
	expect(missing.statusCode).toBe(404);
});

test("an administrator grants browse access and search follows it", async () => {
	const added = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/projects/${projectKey}/roles/viewer/actors`,
		{ actorType: "user", actorId: alice.id },
	);
	expect(added.statusCode).toBe(201);
	const addedRole = added.json().role;
	expect(addedRole.actors).toEqual([
		expect.objectContaining({
			actorType: "user",
			parameter: alice.username,
			source: "local",
		}),
	]);

	const projectResponse = await injectAs(
		app,
		alice.session,
		"GET",
		`/api/projects/${projectKey}`,
	);
	expect(projectResponse.statusCode).toBe(200);

	const search = await injectAs(
		app,
		alice.session,
		"GET",
		`/api/search?jql=${encodeURIComponent(`project = ${projectKey}`)}`,
	);
	expect(search.statusCode).toBe(200);
	expect(search.json().total).toBe(1);
	expect(search.json().issues[0].key).toBe(project.issueKeys[0]);

	const nonAdmin = await rolesFor(alice);
	expect(nonAdmin.statusCode).toBe(403);
	expect(nonAdmin.json().error).toContain("ADMINISTER_PROJECTS");

	const forbiddenAdd = await injectAs(
		app,
		alice.session,
		"POST",
		`/api/projects/${projectKey}/roles/viewer/actors`,
		{ actorType: "user", actorId: bob.id },
	);
	expect(forbiddenAdd.statusCode).toBe(403);
	const forbiddenRemove = await injectAs(
		app,
		alice.session,
		"DELETE",
		`/api/projects/${projectKey}/roles/viewer/actors/${addedRole.actors[0].id}`,
	);
	expect(forbiddenRemove.statusCode).toBe(403);

	const secondAdd = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/projects/${projectKey}/roles/viewer/actors`,
		{ actorType: "user", actorId: alice.id },
	);
	expect(secondAdd.statusCode).toBe(200);
	expect(secondAdd.json().role.actors).toHaveLength(1);

	const actorId = addedRole.actors[0].id as string;
	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/projects/${projectKey}/roles/viewer/actors/${actorId}`,
	);
	expect(removed.statusCode).toBe(204);

	const afterRemoval = await injectAs(
		app,
		alice.session,
		"GET",
		`/api/projects/${projectKey}`,
	);
	expect(afterRemoval.statusCode).toBe(404);
	const searchAfter = await injectAs(
		app,
		alice.session,
		"GET",
		`/api/search?jql=${encodeURIComponent(`project = ${projectKey}`)}`,
	);
	expect(searchAfter.json().total).toBe(0);

	const audits = await db
		.select({ action: auditLog.action, summary: auditLog.summary })
		.from(auditLog)
		.where(eq(auditLog.entityId, project.projectId));
	expect(audits.map((row) => row.action)).toEqual(
		expect.arrayContaining([
			"project.role.actor.add",
			"project.role.actor.remove",
		]),
	);
});

test("a group actor works through membership", async () => {
	await db.insert(userGroups).values({
		userId: alice.id,
		groupId: localGroupId,
		source: "local",
	});
	const added = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/projects/${projectKey}/roles/viewer/actors`,
		{ actorType: "group", actorId: localGroupId },
	);
	expect(added.statusCode).toBe(201);
	const groupActor = added
		.json()
		.role.actors.find(
			(actor: { actorType: string }) => actor.actorType === "group",
		);
	expect(groupActor).toMatchObject({
		parameter: groupName,
		source: "local",
	});

	const projectResponse = await injectAs(
		app,
		alice.session,
		"GET",
		`/api/projects/${projectKey}`,
	);
	expect(projectResponse.statusCode).toBe(200);

	const userRoles = await injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/users/${alice.id}/project-roles`,
	);
	expect(userRoles.statusCode).toBe(200);
	expect(userRoles.json().roles).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				projectKey,
				roleId: "viewer",
				actorId: null,
				viaGroups: [groupName],
			}),
		]),
	);

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/projects/${projectKey}/roles/viewer/actors/${groupActor.id}`,
	);
	expect(removed.statusCode).toBe(204);
	const afterRemoval = await injectAs(
		app,
		alice.session,
		"GET",
		`/api/projects/${projectKey}`,
	);
	expect(afterRemoval.statusCode).toBe(404);
});

test("local actors and locally removed imported actors survive a re-import", async () => {
	const first = await importPermissions(jiraClient(), {
		projectKeys: [importedKey],
		fullImport: true,
		fetchGlobal: false,
	});
	expect(first.counts.project_role_actors?.inserted).toBe(1);

	const imported = await importedRoles();
	expect(imported.statusCode).toBe(200);
	const developers = findRole(imported.json(), "10001");
	expect(developers?.name).toBe("Developers");
	expect(developers?.actors).toEqual([
		expect.objectContaining({
			parameter: `t-${run}-fixture`,
			source: "imported",
		}),
	]);

	const added = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/projects/${importedKey}/roles/10001/actors`,
		{ actorType: "user", actorId: alice.id },
	);
	expect(added.statusCode).toBe(201);
	const localActor = added
		.json()
		.role.actors.find(
			(actor: { parameter: string }) => actor.parameter === alice.username,
		);
	expect(localActor.source).toBe("local");

	await importPermissions(jiraClient(), {
		projectKeys: [importedKey],
		fullImport: true,
		fetchGlobal: false,
	});
	const afterSecondImport = await importedRoles();
	const secondDevelopers = findRole(afterSecondImport.json(), "10001");
	expect(
		secondDevelopers?.actors.map(
			(actor: { parameter: string }) => actor.parameter,
		),
	).toEqual(expect.arrayContaining([`t-${run}-fixture`, alice.username]));

	const importedActor = secondDevelopers?.actors.find(
		(actor: { source: string }) => actor.source === "imported",
	);
	if (!importedActor) throw new Error("The imported actor disappeared");
	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/projects/${importedKey}/roles/10001/actors/${importedActor.id}`,
	);
	expect(removed.statusCode).toBe(204);
	const tombstones = await db
		.select({ sourceId: permissionLocalRemovals.sourceId })
		.from(permissionLocalRemovals);
	expect(
		tombstones.some((row) => row.sourceId.startsWith(`jira:${importedKey}:`)),
	).toBe(true);

	await importPermissions(jiraClient(), {
		projectKeys: [importedKey],
		fullImport: true,
		fetchGlobal: false,
	});
	const afterThirdImport = await importedRoles();
	const thirdDevelopers = findRole(afterThirdImport.json(), "10001");
	expect(
		thirdDevelopers?.actors.map(
			(actor: { parameter: string }) => actor.parameter,
		),
	).toEqual([alice.username]);

	const aliceProject = await injectAs(
		app,
		alice.session,
		"GET",
		`/api/projects/${importedKey}`,
	);
	expect(aliceProject.statusCode).toBe(200);

	const rows = await db
		.select({ sourceId: projectRoleActors.sourceId })
		.from(projectRoleActors)
		.where(eq(projectRoleActors.projectId, importedProject.projectId));
	expect(rows.some((row) => row.sourceId.startsWith("local:"))).toBe(true);
});
