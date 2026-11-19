import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { userForSession } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import * as suggestModule from "../src/lib/server/jql/suggest.ts";
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
let fixture: SeedResult;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const loggedIn = await login(app, {
		sub: `sub-${run}`,
		username: `t-${run}-suggest`,
		name: "Suggest User",
		groups: [],
	});
	session = loggedIn.sessionId as string;

	fixture = await createProjectFixture(client, {
		run,
		key,
		issues: [
			{ summary: "Zephyr one", labels: ["alpha", "beta"] },
			{ summary: "Zephyr two", labels: ["gamma"] },
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

function suggest(field: string, prefix = "") {
	return app.inject({
		method: "GET",
		url: `/api/jql/suggest?field=${encodeURIComponent(field)}&prefix=${encodeURIComponent(prefix)}`,
		cookies: { sid: session },
	});
}

test("project values are keys and names", async () => {
	const response = await suggest("project", key.slice(0, 4));
	expect(response.statusCode).toBe(200);
	expect(response.json().values).toContain(key);
});

test("status, priority and resolution values come from the catalog", async () => {
	expect((await suggest("status", "To")).json().values).toContain("To Do");
	expect((await suggest("status", "In Prog")).json().values).toContain(
		"In Progress",
	);
	expect((await suggest("priority", "h")).json().values).toContain("High");
	expect((await suggest("issuetype", "bu")).json().values).toContain("Bug");
	expect((await suggest("resolution", "Unr")).json().values).toEqual([
		"Unresolved",
	]);
});

test("user fields suggest usernames", async () => {
	const values = (await suggest("assignee", `t-${run}`)).json().values;
	expect(values).toContain(`t-${run}-suggest`);
});

test("labels and issue keys are suggested", async () => {
	const labels = (await suggest("labels", "al")).json().values;
	expect(labels).toContain("alpha");

	const keys = (await suggest("epicLink", key)).json().values;
	expect(keys).toEqual(expect.arrayContaining(fixture.issueKeys));
});

test("an unknown field suggests nothing", async () => {
	expect((await suggest("notafield")).json().values).toEqual([]);
});

test("the prefix filters values", async () => {
	const values = (await suggest("status", "done")).json().values;
	expect(values).toEqual(["Done"]);
});

test("suggest requires a session", async () => {
	const response = await app.inject({
		method: "GET",
		url: "/api/jql/suggest?field=status",
	});
	expect(response.statusCode).toBe(401);
});

test("suggestValues is not exported without a viewer", () => {
	expect("suggestValues" in suggestModule).toBe(false);
});

test("suggest clamps a zero limit inside the function", async () => {
	const actor = await userForSession(session);
	if (!actor) throw new Error("The test session has no user");
	const result = await suggestModule.suggest(actor, {
		field: "status",
		prefix: "",
		limit: 0,
	});
	expect(result.values.length).toBeGreaterThan(0);
});
