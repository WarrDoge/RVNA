import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
	importPermissions,
	type PermissionImportClient,
} from "../src/importer/permissions.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	groups,
	permissionGrants,
	permissionLocalRemovals,
	permissionSchemes,
	userGroups,
	users,
} from "../src/lib/server/schema.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
} from "./fixtures/project.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const jiraAdministrators = "jira-administrators";
const seedId = `global:ADMINISTER:group:${jiraAdministrators}`;
const importedName = `t-${run}-Jira-Software-Users`;
const projectKey = fixtureKey(run);

let app: TestApp;
let importedUserId: string;
let createdAdministratorsGroup = false;
let createdGlobalScheme = false;
let savedHolders: (typeof permissionGrants.$inferSelect)[] = [];
let savedRemovals: string[] = [];
let projectFixtureClient: Client;

function stub(groupNames: string[]): PermissionImportClient {
	return {
		async getJson<T>(path: string) {
			if (path === "/rest/api/2/groups/picker") {
				return {
					groups: groupNames.map((name) => ({ name })),
					total: groupNames.length,
				} as T;
			}
			if (path === "/rest/api/2/group/member") {
				return { values: [], isLast: true } as T;
			}
			if (path === "/rest/api/2/user/permission/search") {
				return { users: [] } as T;
			}
			throw new Error("not found");
		},
	};
}

async function importGlobal(groupNames: string[] = []) {
	return importPermissions(stub(groupNames), {
		projectKeys: [],
		fullImport: false,
		fetchGlobal: true,
	});
}

async function globalSchemeId() {
	const [scheme] = await db
		.select({ id: permissionSchemes.id })
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, "global"));
	return scheme?.id;
}

async function isAdminAfterLogin(user: string, claim: string[]) {
	const { sessionId, callback } = await login(app, {
		sub: `${run}-${user}`,
		username: user,
		name: "Admin Probe",
		groups: claim,
	});
	expect(callback.statusCode).toBe(303);
	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: sessionId as string },
	});
	return me.json().isAdmin as boolean;
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();

	let id = await globalSchemeId();
	if (!id) {
		[{ id }] = await db
			.insert(permissionSchemes)
			.values({ sourceId: "global", name: "Global", projectIds: [], raw: {} })
			.returning({ id: permissionSchemes.id });
		createdGlobalScheme = true;
	}
	savedHolders = await db
		.select()
		.from(permissionGrants)
		.where(
			and(
				eq(permissionGrants.schemeId, id as string),
				eq(permissionGrants.permissionKey, "ADMINISTER"),
				eq(permissionGrants.holderType, "group"),
			),
		);
	await db
		.delete(permissionGrants)
		.where(
			and(
				eq(permissionGrants.schemeId, id as string),
				eq(permissionGrants.permissionKey, "ADMINISTER"),
				eq(permissionGrants.holderType, "group"),
			),
		);
	savedRemovals = (
		await db
			.delete(permissionLocalRemovals)
			.where(eq(permissionLocalRemovals.sourceId, seedId))
			.returning()
	).map((row) => row.sourceId);

	const [existing] = await db
		.select({ id: groups.id })
		.from(groups)
		.where(sql`lower(${groups.name}) = ${jiraAdministrators}`);
	if (!existing) {
		await db.insert(groups).values({ name: jiraAdministrators });
		createdAdministratorsGroup = true;
	}

	const [imported] = await db
		.insert(users)
		.values({
			username: `t-${run}-imported`,
			displayName: "Imported Administrator",
			sourceKey: `jira-${run}-imported`,
		})
		.returning();
	importedUserId = imported.id;
});

afterAll(async () => {
	await pool.query(
		"delete from permission_grants where source_id = $1 or source_id like $2",
		[seedId, `${run}:%`],
	);
	await pool.query(
		"delete from permission_local_removals where source_id = $1",
		[seedId],
	);
	if (savedHolders.length > 0) {
		await db.insert(permissionGrants).values(savedHolders);
	}
	for (const sourceId of savedRemovals) {
		await db.insert(permissionLocalRemovals).values({ sourceId });
	}
	if (createdGlobalScheme) {
		await pool.query(
			"delete from permission_schemes where source_id = 'global'",
		);
	}
	await pool.query("delete from permission_schemes where source_id like $1", [
		`${run}:%`,
	]);
	if (createdAdministratorsGroup) {
		await pool.query("delete from groups where name = $1", [
			jiraAdministrators,
		]);
	}
	if (projectFixtureClient) {
		await dropProjectFixture(projectFixtureClient, run);
		await projectFixtureClient.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("the group is not an administrator group until the import seeds it", async () => {
	expect(await isAdminAfterLogin(`t-${run}-before`, [jiraAdministrators])).toBe(
		false,
	);
});

test("the import seeds the Jira administrators group as a global administrator", async () => {
	const first = await importGlobal();
	expect(
		first.report.filter((line) => line.includes("seeded group")),
	).toHaveLength(1);

	const holders = await db
		.select()
		.from(permissionGrants)
		.where(eq(permissionGrants.sourceId, seedId));
	expect(holders).toHaveLength(1);
	expect(holders[0]?.holderType).toBe("group");

	expect(
		await isAdminAfterLogin(`t-${run}-claimed`, [jiraAdministrators]),
	).toBe(true);
	expect(await isAdminAfterLogin(`t-${run}-claimed`, [])).toBe(false);

	const [group] = await db
		.select({ id: groups.id })
		.from(groups)
		.where(sql`lower(${groups.name}) = ${jiraAdministrators}`);
	await db.insert(userGroups).values({
		userId: importedUserId,
		groupId: (group as { id: string }).id,
		source: "jira",
	});
	expect(await isAdminAfterLogin(`t-${run}-imported`, [])).toBe(true);

	const second = await importGlobal();
	expect(second.report.some((line) => line.includes("seeded group"))).toBe(
		false,
	);
	expect(
		await db
			.select()
			.from(permissionGrants)
			.where(eq(permissionGrants.sourceId, seedId)),
	).toHaveLength(1);
});

test("an administrator removes the grant and a later import keeps it removed", async () => {
	const admin = await login(app, {
		sub: `${run}-admin`,
		username: `t-${run}-admin`,
		name: "App Administrator",
		groups: [adminGroup()],
	});
	const cookies = { sid: admin.sessionId as string };
	const headers = { "x-requested-with": "rvna" };

	const listed = await app.inject({
		method: "GET",
		url: "/api/admin/global-permissions",
		cookies,
	});
	const holder = (
		listed.json().holders as {
			id: string;
			holderParameter: string;
			source: string;
		}[]
	).find((row) => row.holderParameter.toLowerCase() === jiraAdministrators);
	expect(holder?.source).toBe("imported");

	const removed = await app.inject({
		method: "DELETE",
		url: `/api/admin/global-permissions/${holder?.id}`,
		cookies,
		headers,
	});
	expect(removed.statusCode).toBe(204);
	expect(await isAdminAfterLogin(`t-${run}-imported`, [])).toBe(false);

	const third = await importGlobal();
	expect(third.report.some((line) => line.includes("seeded group"))).toBe(
		false,
	);
	expect(
		await db
			.select()
			.from(permissionGrants)
			.where(eq(permissionGrants.sourceId, seedId)),
	).toHaveLength(0);
	expect(await isAdminAfterLogin(`t-${run}-imported`, [])).toBe(false);
	expect(
		await isAdminAfterLogin(`t-${run}-claimed`, [jiraAdministrators]),
	).toBe(false);
});

test("a group that already holds global ADMINISTER stops the seeding", async () => {
	await pool.query(
		"delete from permission_local_removals where source_id = $1",
		[seedId],
	);
	const id = (await globalSchemeId()) as string;
	await db.insert(permissionGrants).values({
		sourceId: `${run}:holder`,
		schemeId: id,
		permissionKey: "ADMINISTER",
		holderType: "group",
		holderParameter: `t-${run}-holders`,
		raw: {},
	});
	const result = await importGlobal();
	expect(result.report.some((line) => line.includes("seeded group"))).toBe(
		false,
	);
	await pool.query("delete from permission_grants where source_id = $1", [
		`${run}:holder`,
	]);
});

test("a claim group named like an imported Jira group joins the same group row", async () => {
	projectFixtureClient = new Client({
		connectionString: process.env.DATABASE_URL,
	});
	await projectFixtureClient.connect();
	const fixture = await createProjectFixture(projectFixtureClient, {
		run,
		key: projectKey,
		issues: [{ summary: `Group access issue ${run}` }],
	});
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `${run}:browse`,
			name: "browse",
			projectIds: [fixture.projectId],
			raw: {},
		})
		.returning();
	await db.insert(permissionGrants).values({
		sourceId: `${run}:browse:grant`,
		schemeId: scheme.id,
		permissionKey: "BROWSE_PROJECTS",
		holderType: "group",
		holderParameter: importedName,
		raw: {},
	});

	await importGlobal([importedName]);
	const rowsNamed = () =>
		db
			.select({ id: groups.id, name: groups.name })
			.from(groups)
			.where(sql`lower(${groups.name}) = ${importedName.toLowerCase()}`);
	const [imported] = await rowsNamed();
	expect(imported?.name).toBe(importedName);

	for (const [index, claim] of [
		importedName,
		importedName.toLowerCase(),
	].entries()) {
		const user = `t-${run}-sso${index}`;
		const { sessionId } = await login(app, {
			sub: `${run}-${user}`,
			username: user,
			name: "New SSO User",
			groups: [claim],
		});
		const projects = await app.inject({
			method: "GET",
			url: "/api/projects",
			cookies: { sid: sessionId as string },
		});
		expect(
			(projects.json() as { key: string }[]).map((row) => row.key),
		).toContain(projectKey);
		expect(await rowsNamed()).toHaveLength(1);
		const memberships = await db
			.select({ source: userGroups.source })
			.from(userGroups)
			.innerJoin(users, eq(users.id, userGroups.userId))
			.where(
				and(eq(userGroups.groupId, imported.id), eq(users.username, user)),
			);
		expect(memberships.map((row) => row.source)).toEqual(["oidc"]);
	}
});

test("the import reuses a group row a login created under another spelling", async () => {
	const claimOnly = `t-${run}-claim-first`;
	await login(app, {
		sub: `${run}-claim-user`,
		username: `t-${run}-claimer`,
		name: "Claim First",
		groups: [claimOnly.toLowerCase()],
	});
	await importGlobal([`T-${run}-Claim-First`]);
	const rows = await db
		.select({ name: groups.name })
		.from(groups)
		.where(sql`lower(${groups.name}) = ${claimOnly.toLowerCase()}`);
	expect(rows).toHaveLength(1);
});
