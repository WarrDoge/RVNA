import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	groups,
	permissionGrants,
	permissionSchemes,
	projects,
	spacePermissions,
	spaces,
	userGroups,
} from "../src/lib/server/schema.ts";
import { searchUsers } from "../src/lib/server/users.ts";
import { makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
let app: TestApp;
const projectIds: string[] = [];
const schemeIds: string[] = [];
const spaceIds: string[] = [];
const groupIds: string[] = [];
let viewer: TestUser;
let alone: TestUser;
let admin: TestUser;
let member: TestUser;

function actor(user: TestUser, isAdmin = false, names: string[] = []) {
	return {
		id: user.id,
		username: user.username,
		displayName: user.username,
		email: null,
		avatarUrl: null,
		groups: names,
		isAdmin,
		mustChangePassword: false,
		hasPassword: false,
	} satisfies CurrentUser;
}

async function visibleProject(label: string, browsers: string[]) {
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `test:${run}:${label}`,
			key: `D${run.slice(0, 3)}${label}`.toUpperCase(),
			name: `Directory ${label} ${run}`,
			projectType: "software",
		})
		.returning({ id: projects.id });
	projectIds.push(project.id);
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `test:${run}:${label}`,
			name: label,
			projectIds: [project.id],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	schemeIds.push(scheme.id);
	await db.insert(permissionGrants).values(
		browsers.map((username, index) => ({
			sourceId: `test:${run}:${label}:${index}`,
			schemeId: scheme.id,
			permissionKey: "BROWSE_PROJECTS",
			holderType: "user",
			holderParameter: username,
			raw: {},
		})),
	);
}

async function space(
	label: string,
	readers: { userId?: string; groupName?: string; anonymous?: boolean }[],
) {
	const [row] = await db
		.insert(spaces)
		.values({
			sourceId: `test:${run}:${label}`,
			key: `D${run.slice(0, 3)}${label}`.toUpperCase(),
			name: `Directory ${label} ${run}`,
		})
		.returning({ id: spaces.id });
	spaceIds.push(row.id);
	await db.insert(spacePermissions).values(
		readers.map((reader, index) => ({
			sourceId: `test:${run}:${label}:${index}`,
			spaceId: row.id,
			permission: "read",
			userId: reader.userId ?? null,
			groupName: reader.groupName ?? null,
			anonymous: reader.anonymous ?? false,
		})),
	);
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();

	viewer = await makeUser(run, "viewer");
	alone = await makeUser(run, "alone");
	admin = await makeUser(run, "admin", { admin: true });
	const colleague = await makeUser(run, "colleague");
	const retired = await makeUser(run, "retired", { active: false });
	const other = await makeUser(run, "other");
	const writer = await makeUser(run, "writer");
	member = await makeUser(run, "member");
	const stranger = await makeUser(run, "stranger");
	await makeUser(run, "nobody");

	await visibleProject("one", [
		viewer.username,
		colleague.username,
		retired.username,
	]);
	await visibleProject("two", [other.username]);

	const [team] = await db
		.insert(groups)
		.values({ name: `t-${run}-wiki-team` })
		.returning({ id: groups.id });
	groupIds.push(team.id);
	await db.insert(userGroups).values({ userId: member.id, groupId: team.id });
	await space("open", [
		{ userId: writer.id },
		{ groupName: `t-${run}-wiki-team` },
	]);
	await space("closed", [{ userId: stranger.id }]);
	await space("public", [{ anonymous: true }]);
});

afterAll(async () => {
	if (spaceIds.length > 0) {
		await db.delete(spaces).where(inArray(spaces.id, spaceIds));
	}
	if (schemeIds.length > 0) {
		await db
			.delete(permissionSchemes)
			.where(inArray(permissionSchemes.id, schemeIds));
	}
	if (projectIds.length > 0) {
		await db.delete(projects).where(inArray(projects.id, projectIds));
	}
	if (groupIds.length > 0) {
		await db.delete(groups).where(inArray(groups.id, groupIds));
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

const names = async (
	user: TestUser,
	isAdmin = false,
	groupNames: string[] = [],
) =>
	(await searchUsers(actor(user, isAdmin, groupNames), `t-${run}-`))
		.map((entry) => entry.username.replace(`t-${run}-`, ""))
		.sort();

test("a user finds the people who browse the same projects, and themselves", async () => {
	const found = await names(viewer);
	expect(found).toContain("viewer");
	expect(found).toContain("colleague");
	for (const hidden of ["other", "stranger", "nobody", "alone", "retired"]) {
		expect(found, hidden).not.toContain(hidden);
	}
});

test("a user finds the people who read a wiki space they can read", async () => {
	const team = [`t-${run}-wiki-team`];
	const found = await names(member, false, team);
	expect(found).toEqual(expect.arrayContaining(["member", "writer"]));
	for (const hidden of ["viewer", "stranger", "other"]) {
		expect(found, hidden).not.toContain(hidden);
	}
});

test("a space that anonymous visitors may read does not open the directory", async () => {
	expect(await names(alone)).not.toContain("stranger");
});

test("a user with no project and no space finds only themselves", async () => {
	expect(await names(alone)).toEqual(["alone"]);
});

test("an administrator finds every active account, with the email", async () => {
	const found = await searchUsers(actor(admin, true), `t-${run}-`);
	expect(found.length).toBeGreaterThanOrEqual(9);
	expect(found.every((entry) => entry.email)).toBe(true);
	expect(found.map((entry) => entry.username)).not.toContain(
		`t-${run}-retired`,
	);
});

test("GET /api/users answers with the same scope", async () => {
	const asViewer = await app.inject({
		method: "GET",
		url: `/api/users?query=${encodeURIComponent(`t-${run}-`)}`,
		cookies: { sid: viewer.session },
	});
	expect(asViewer.statusCode).toBe(200);
	const listed = asViewer
		.json()
		.map((entry: { username: string }) => entry.username);
	expect(listed).toContain(`t-${run}-colleague`);
	expect(listed).not.toContain(`t-${run}-stranger`);
	expect(listed).not.toContain(`t-${run}-other`);

	const asAlone = await app.inject({
		method: "GET",
		url: `/api/users?query=${encodeURIComponent(`t-${run}-`)}`,
		cookies: { sid: alone.session },
	});
	expect(
		asAlone.json().map((entry: { username: string }) => entry.username),
	).toEqual([`t-${run}-alone`]);
});
