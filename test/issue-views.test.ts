import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { userForSession } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { recentIssues } from "../src/lib/server/navigator/service.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const key = fixtureKey(run);
let app: TestApp;
let client: Client;
let session: string;
let otherSession: string;
let fixture: SeedResult;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const first = await login(app, {
		sub: `sub-${run}`,
		username: `t-${run}-one`,
		name: "Viewer One",
		groups: [],
	});
	const second = await login(app, {
		sub: `sub-${run}-two`,
		username: `t-${run}-two`,
		name: "Viewer Two",
		groups: [],
	});
	session = first.sessionId as string;
	otherSession = second.sessionId as string;

	fixture = await createProjectFixture(client, {
		run,
		key,
		issues: [
			{ summary: "First viewed issue" },
			{ summary: "Second viewed issue" },
			{ summary: "Third viewed issue" },
		],
	});
});

afterAll(async () => {
	if (client) {
		await dropProjectFixture(client, run);
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function open(issueKey: string, sid = session) {
	return app.inject({
		method: "GET",
		url: `/api/issues/${issueKey}`,
		cookies: { sid },
	});
}

function recent(sid = session, limit = 5) {
	return app.inject({
		method: "GET",
		url: `/api/issues/recent?limit=${limit}`,
		cookies: { sid },
	});
}

test("opening an issue records it in issue_views", async () => {
	const response = await open(fixture.issueKeys[0] as string);
	expect(response.statusCode).toBe(200);

	const stored = await client.query(
		"select issue_id from issue_views where issue_id = $1",
		[fixture.issueIds[0]],
	);
	expect(stored.rowCount).toBe(1);

	const list = await recent();
	expect(list.statusCode).toBe(200);
	expect(list.json().issues[0]).toMatchObject({
		key: fixture.issueKeys[0],
		summary: "First viewed issue",
	});
	expect(list.json().issues[0].type.name).toBe("Task");
	expect(list.json().issues[0].viewedAt).toEqual(expect.any(String));
});

test("the most recently opened issue comes first", async () => {
	await open(fixture.issueKeys[1] as string);
	await open(fixture.issueKeys[2] as string);

	const keys = (await recent())
		.json()
		.issues.map((issue: { key: string }) => issue.key);
	expect(keys.slice(0, 3)).toEqual([
		fixture.issueKeys[2],
		fixture.issueKeys[1],
		fixture.issueKeys[0],
	]);
});

test("opening an issue again moves it to the front without duplicating it", async () => {
	await open(fixture.issueKeys[0] as string);

	const keys = (await recent())
		.json()
		.issues.map((issue: { key: string }) => issue.key);
	expect(keys[0]).toBe(fixture.issueKeys[0]);
	expect(new Set(keys).size).toBe(keys.length);

	const count = await client.query(
		"select count(*)::int as total from issue_views where issue_id = $1",
		[fixture.issueIds[0]],
	);
	expect(count.rows[0].total).toBe(1);
});

test("the limit is applied", async () => {
	const list = await recent(session, 1);
	expect(list.json().issues).toHaveLength(1);
});

test("views are per user", async () => {
	const list = await recent(otherSession);
	expect(list.json().issues).toEqual([]);
});

test("recent issues require a session", async () => {
	const response = await app.inject({
		method: "GET",
		url: "/api/issues/recent",
	});
	expect(response.statusCode).toBe(401);
});

test("recentIssues clamps the limit inside the function", async () => {
	await open(fixture.issueKeys[0] as string);
	const actor = await userForSession(session);
	if (!actor) throw new Error("The test session has no user");
	const result = await recentIssues(actor, 0);
	expect(result.issues.length).toBe(1);
});
