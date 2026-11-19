import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const key = fixtureKey(run);
let app: TestApp;
let client: Client;
let session: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const loggedIn = await login(app, {
		sub: `sub-${run}`,
		username: `t-${run}-quick`,
		name: "Quick User",
		groups: [],
	});
	session = loggedIn.sessionId as string;

	await createProjectFixture(client, {
		run,
		key,
		issues: [
			{
				summary: "Zephyr payload calibration",
				description: "A note about the quokka procedure",
			},
			{ summary: "Second Zephyr task" },
			{ summary: "Unrelated work" },
			...Array.from({ length: 8 }, (_, index) => ({
				summary: `Widget batch ${index + 1}`,
			})),
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

function search(query: string) {
	return app.inject({
		method: "GET",
		url: `/api/quicksearch?q=${encodeURIComponent(query)}`,
		cookies: { sid: session },
	});
}

test("an issue key prefix returns the matching issues", async () => {
	const response = await search(`${key}-`);
	expect(response.statusCode).toBe(200);
	const body = response.json();
	expect(body.issues).toHaveLength(6);
	expect(body.issues[0].key).toBe(`${key}-1`);
	expect(body.issues[0].type.name).toBe("Task");
});

test("an exact key comes first", async () => {
	const body = (await search(`${key}-2`)).json();
	expect(body.issues[0].key).toBe(`${key}-2`);
});

test("summary and description text are searched", async () => {
	const bySummary = (await search("zephyr")).json();
	expect(bySummary.issues).toHaveLength(2);

	const byDescription = (await search("quokka")).json();
	expect(byDescription.issues).toHaveLength(1);
	expect(byDescription.issues[0].key).toBe(`${key}-1`);
});

test("projects match by key and name", async () => {
	const byKey = (await search(key.slice(0, 4))).json();
	expect(byKey.projects[0].key).toBe(key);
	expect(byKey.projects[0].avatarUrl).toMatch(/^\/api\/avatars\/projects\//);

	const byName = (await search(`Fixture ${key}`)).json();
	expect(byName.projects[0].key).toBe(key);
});

test("the result list is capped at six issues", async () => {
	const body = (await search("widget")).json();
	expect(body.issues).toHaveLength(6);
});

test("an empty query returns nothing", async () => {
	const body = (await search("")).json();
	expect(body).toEqual({ issues: [], projects: [], pages: [] });
});

test("wildcards in the query are matched literally", async () => {
	const body = (await search("_")).json();
	expect(
		body.issues.some((issue: { key: string }) =>
			issue.key.startsWith(`${key}-`),
		),
	).toBe(false);
});

test("quick search requires a session", async () => {
	const response = await app.inject({
		method: "GET",
		url: "/api/quicksearch?q=DEMO",
	});
	expect(response.statusCode).toBe(401);
});
