import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	groups,
	permissionGrants,
	permissionSchemes,
	spacePermissions,
	spaces,
	userGroups,
	users,
} from "../src/lib/server/schema.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "./fixtures/project.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const username = `t-${run}-imported`;
const jiraGroup = `t-${run}-jira-devs`;
const confluenceGroup = `t-${run}-confluence-readers`;
const claimGroup = `t-${run}-claim-only`;
const jiraKey = fixtureKey(run);
const claimKey = `CL${run.slice(0, 5).toUpperCase()}`;
const jiraSpaceKey = `SJ${run.slice(0, 5).toUpperCase()}`;
const claimSpaceKey = `SC${run.slice(0, 5).toUpperCase()}`;

let app: TestApp;
let client: Client;
let jiraProject: SeedResult;
let claimProject: SeedResult;
let importedId: string;
let adminGroupId: string;
let appAdminGroupId: string;
let globalSchemeCreated = false;
const adminHolderGroup = `t-${run}-jira-admins`;

async function grantBrowse(projectId: string, group: string, tag: string) {
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `${run}:${tag}`,
			name: tag,
			projectIds: [projectId],
			raw: {},
		})
		.returning();
	await db.insert(permissionGrants).values({
		sourceId: `${run}:${tag}:browse`,
		schemeId: scheme.id,
		permissionKey: "BROWSE_PROJECTS",
		holderType: "group",
		holderParameter: group,
		raw: {},
	});
}

async function space(key: string, group: string) {
	const [row] = await db
		.insert(spaces)
		.values({
			sourceId: `${run}-space-${key}`,
			key,
			name: `Space ${key}`,
			type: "global",
		})
		.returning();
	await db.insert(spacePermissions).values({
		sourceId: `${run}-read-${key}`,
		spaceId: row.id,
		permission: "read",
		groupName: group,
	});
}

async function viewFor(sessionId: string) {
	const cookies = { sid: sessionId };
	const projects = await app.inject({
		method: "GET",
		url: "/api/projects",
		cookies,
	});
	const wiki = await app.inject({
		method: "GET",
		url: "/api/wiki/spaces",
		cookies,
	});
	return {
		projects: (projects.json() as { key: string }[]).map((row) => row.key),
		spaces: (wiki.json() as { key: string }[]).map((row) => row.key),
	};
}

async function sso(groupsClaim: string[], user = username) {
	const { sessionId, callback } = await login(app, {
		sub: `${run}-${user}`,
		username: user,
		name: "Imported Person",
		groups: groupsClaim,
	});
	expect(callback.statusCode).toBe(303);
	return viewFor(sessionId as string);
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const [imported] = await db
		.insert(users)
		.values({
			username,
			displayName: "Imported Person",
			sourceKey: `jira-${run}-imported`,
		})
		.returning();
	importedId = imported.id;
	const memberships = await db
		.insert(groups)
		.values([{ name: jiraGroup }, { name: confluenceGroup }])
		.returning();
	await db.insert(userGroups).values(
		memberships.map((group) => ({
			userId: importedId,
			groupId: group.id,
			source: "jira",
		})),
	);

	jiraProject = await createProjectFixture(client, {
		run: `${run}jira`,
		key: jiraKey,
		issues: [{ summary: `Jira group issue ${run}` }],
	});
	claimProject = await createProjectFixture(client, {
		run: `${run}claim`,
		key: claimKey,
		issues: [{ summary: `Claim group issue ${run}` }],
	});
	await grantBrowse(jiraProject.projectId, jiraGroup, "jira");
	await grantBrowse(claimProject.projectId, claimGroup, "claim");
	await space(jiraSpaceKey, confluenceGroup);
	await space(claimSpaceKey, claimGroup);

	let [globalScheme] = await db
		.select()
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, "global"));
	if (!globalScheme) {
		[globalScheme] = await db
			.insert(permissionSchemes)
			.values({ sourceId: "global", name: "Global", projectIds: [], raw: {} })
			.returning();
		globalSchemeCreated = true;
	}
	await db.insert(permissionGrants).values({
		sourceId: `${run}:global-admin`,
		schemeId: globalScheme.id,
		permissionKey: "ADMINISTER",
		holderType: "group",
		holderParameter: adminHolderGroup,
		raw: {},
	});
	const [holder] = await db
		.insert(groups)
		.values({ name: adminHolderGroup })
		.returning();
	adminGroupId = holder.id;
	const [appAdminGroup] = await db
		.insert(groups)
		.values({ name: adminGroup() })
		.onConflictDoNothing()
		.returning({ id: groups.id });
	appAdminGroupId =
		appAdminGroup?.id ??
		(
			await db
				.select({ id: groups.id })
				.from(groups)
				.where(eq(groups.name, adminGroup()))
		)[0]?.id;
});

afterAll(async () => {
	await pool.query("delete from permission_grants where source_id = $1", [
		`${run}:global-admin`,
	]);
	if (globalSchemeCreated) {
		await pool.query(
			"delete from permission_schemes where source_id = 'global'",
		);
	}
	await pool.query("delete from permission_schemes where source_id like $1", [
		`${run}:%`,
	]);
	await pool.query("delete from spaces where key = any($1)", [
		[jiraSpaceKey, claimSpaceKey],
	]);
	await dropProjectFixture(client, `${run}jira`);
	await dropProjectFixture(client, `${run}claim`);
	await client.end();
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("an imported user keeps imported memberships when SSO carries other groups", async () => {
	const view = await sso([claimGroup]);
	expect(view.projects).toContain(jiraKey);
	expect(view.projects).toContain(claimKey);
	expect(view.spaces).toContain(jiraSpaceKey);
	expect(view.spaces).toContain(claimSpaceKey);

	const [row] = (
		await pool.query<{ oidc_sub: string | null }>(
			"select oidc_sub from users where id = $1",
			[importedId],
		)
	).rows;
	expect(row.oidc_sub).toBe(`${run}-${username}`);
	const kept = await pool.query(
		"select source from user_groups where user_id = $1 order by source",
		[importedId],
	);
	expect(kept.rows.map((r) => r.source)).toEqual(["jira", "jira", "oidc"]);
});

test("a later login without the claim drops only the claim access", async () => {
	const view = await sso([]);
	expect(view.projects).toContain(jiraKey);
	expect(view.projects).not.toContain(claimKey);
	expect(view.spaces).toContain(jiraSpaceKey);
	expect(view.spaces).not.toContain(claimSpaceKey);
});

test("a new SSO user in no group sees neither the grouped projects nor spaces", async () => {
	const view = await sso([], `t-${run}-fresh`);
	expect(view.projects).not.toContain(jiraKey);
	expect(view.projects).not.toContain(claimKey);
	expect(view.spaces).not.toContain(jiraSpaceKey);
	expect(view.spaces).not.toContain(claimSpaceKey);
});

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

test("a group that holds the imported global ADMINISTER permission makes its members administrators", async () => {
	expect(await isAdminAfterLogin(`t-${run}-plain`, [])).toBe(false);
	expect(await isAdminAfterLogin(`t-${run}-claimed`, [adminHolderGroup])).toBe(
		true,
	);
	expect(await isAdminAfterLogin(`t-${run}-claimed`, [])).toBe(false);

	await db.insert(userGroups).values({
		userId: importedId,
		groupId: adminGroupId,
		source: "jira",
	});
	expect(await isAdminAfterLogin(username, [])).toBe(true);
	await db
		.delete(userGroups)
		.where(
			and(
				eq(userGroups.userId, importedId),
				eq(userGroups.groupId, adminGroupId),
			),
		);
	expect(await isAdminAfterLogin(username, [])).toBe(false);
});

test("the administrator group in the claim compares without case", async () => {
	expect(
		await isAdminAfterLogin(`t-${run}-case`, [adminGroup().toUpperCase()]),
	).toBe(true);
	expect(await isAdminAfterLogin(`t-${run}-case`, [])).toBe(false);
});

test("a membership of the administrator group from an import or the app survives an SSO login", async () => {
	await db.insert(userGroups).values({
		userId: importedId,
		groupId: appAdminGroupId,
		source: "jira",
	});
	expect(await isAdminAfterLogin(username, [])).toBe(true);
	expect(await isAdminAfterLogin(username, [claimGroup])).toBe(true);

	await db
		.delete(userGroups)
		.where(
			and(
				eq(userGroups.userId, importedId),
				eq(userGroups.groupId, appAdminGroupId),
			),
		);
	expect(await isAdminAfterLogin(username, [])).toBe(false);
});

test("an identity token without a groups claim leaves the memberships alone", async () => {
	const user = `t-${run}-no-claim`;
	const first = await login(app, {
		sub: `${run}-${user}`,
		username: user,
		name: "No Claim",
		groups: [claimGroup, adminGroup()],
	});
	expect(first.callback.statusCode).toBe(303);
	const firstMe = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: first.sessionId as string },
	});
	expect(firstMe.json().isAdmin).toBe(true);

	const second = await login(app, {
		sub: `${run}-${user}`,
		username: user,
		name: "No Claim",
	});
	expect(second.callback.statusCode).toBe(303);
	const secondMe = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: second.sessionId as string },
	});
	expect(secondMe.json().isAdmin).toBe(true);
	const projects = await app.inject({
		method: "GET",
		url: "/api/projects",
		cookies: { sid: second.sessionId as string },
	});
	expect(
		(projects.json() as { key: string }[]).map((row) => row.key),
	).toContain(claimKey);
});
