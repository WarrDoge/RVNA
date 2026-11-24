import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	fields,
	issueHistory,
	issueHistoryItems,
} from "../src/lib/server/schema.ts";
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
const internalName = `Internal desk field ${run}`;

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
		sub: `sub-history-${run}`,
		username: `t-${run}-history`,
		name: "History Reader",
		groups: [],
	});
	session = loggedIn.sessionId as string;
	fixture = await createProjectFixture(client, {
		run,
		key: fixtureKey(run),
		issues: [{ summary: "History subject" }],
	});

	await db.insert(fields).values({
		sourceId: `customfield_8${run}`,
		name: internalName,
		type: "string",
		customKey: "com.atlassian.servicedesk:sd-request-participants",
	});
	const issueId = fixture.issueIds[0] as string;
	const [both, internalOnly] = await db
		.insert(issueHistory)
		.values([
			{ sourceId: `${run}:h1`, issueId, created: new Date() },
			{ sourceId: `${run}:h2`, issueId, created: new Date() },
		])
		.returning();
	await db.insert(issueHistoryItems).values([
		{
			sourceId: `${run}:i1`,
			historyId: (both as { id: string }).id,
			field: "summary",
			fromText: "Old summary",
			toText: "History subject",
			sequence: 0,
		},
		{
			sourceId: `${run}:i2`,
			historyId: (both as { id: string }).id,
			field: internalName,
			fromValue: '{"name":"someone"}',
			toValue: '{"name":"somebody"}',
			sequence: 1,
		},
		{
			sourceId: `${run}:i3`,
			historyId: (internalOnly as { id: string }).id,
			field: `customfield_8${run}`,
			toValue: "secret",
			sequence: 0,
		},
	]);
});

afterAll(async () => {
	if (client) {
		await client.query("delete from fields where source_id = $1", [
			`customfield_8${run}`,
		]);
		await dropProjectFixture(client, run);
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("the history list leaves out the service desk's internal fields", async () => {
	const response = await app.inject({
		method: "GET",
		url: `/api/issues/${fixture.issueKeys[0]}/history`,
		cookies: { sid: session },
	});
	expect(response.statusCode).toBe(200);
	const entries = response.json() as { items: { field: string }[] }[];
	expect(entries).toHaveLength(1);
	expect(entries[0]?.items.map((item) => item.field)).toEqual(["summary"]);
	expect(response.body).not.toContain("secret");
	expect(response.body).not.toContain("somebody");
});
