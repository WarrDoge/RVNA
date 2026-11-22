import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { serviceDesks } from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const fixture = fixtureRun();
const key = fixtureKey(fixture);

let app: TestApp;
let client: Client;
let user: TestUser;
let issueKey: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	user = await makeUser(run, "plain");
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	const project = await createProjectFixture(client, {
		run: fixture,
		key,
		issues: [{ summary: `Moved servicedesk guard ${fixture}` }],
	});
	issueKey = project.issueKeys[0] as string;
	await db.insert(serviceDesks).values({
		sourceId: `${fixture}:servicedesk`,
		projectId: project.projectId,
		portalName: `Moved desk ${fixture}`,
	});
});

afterAll(async () => {
	await dropProjectFixture(client, fixture);
	await cleanupTestData(run);
	await client.end();
	await app.close();
	await pool.end();
});

test("the desk's settings, queue and SLA endpoints refuse a plain user", async () => {
	const guarded = [
		{
			method: "GET",
			url: `/api/servicedesk/projects/${key}/settings`,
			error:
				"You do not have permission to Administer projects in this project",
		},
		{
			method: "PATCH",
			url: `/api/servicedesk/projects/${key}/settings`,
			payload: { openAccess: false },
			error:
				"You do not have permission to Administer projects in this project",
		},
		{
			method: "GET",
			url: `/api/servicedesk/projects/${key}/queues`,
			error: "Only agents can see queues",
		},
		{
			method: "GET",
			url: `/api/servicedesk/projects/${key}/queues/${randomUUID()}`,
			error: "Only agents can see queues",
		},
		{
			method: "GET",
			url: `/api/servicedesk/issues/${issueKey}/sla`,
			error: "Only agents can see SLAs",
		},
	] as const;

	const failures: string[] = [];
	for (const route of guarded) {
		const response = await injectAs(
			app,
			user.session,
			route.method,
			route.url,
			"payload" in route ? route.payload : undefined,
		);
		const body = response.json() as { error?: string };
		if (response.statusCode !== 403 || body.error !== route.error) {
			failures.push(
				`${route.method} ${route.url} -> ${response.statusCode} ${body.error}`,
			);
		}
	}
	expect(failures).toEqual([]);
});
