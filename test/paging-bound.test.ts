import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { MAX_OFFSET } from "../src/lib/server/paging.ts";
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
const tooFar = "99999999999999999999";

let app: TestApp;
let client: Client;
let session: string;
let token: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	const loggedIn = await login(app, {
		sub: `sub-paging-${run}`,
		username: `t-${run}-paging`,
		name: "Paging User",
		groups: [],
	});
	session = loggedIn.sessionId as string;
	await createProjectFixture(client, {
		run,
		key,
		issues: [{ summary: "Paging first issue" }],
	});
	const created = await app.inject({
		method: "POST",
		url: "/api/me/tokens",
		cookies: { sid: session },
		headers: { "x-requested-with": "rvna" },
		payload: { name: `Paging token ${run}` },
	});
	token = created.json().token;
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

function get(url: string, bearer = false) {
	return app.inject({
		method: "GET",
		url,
		...(bearer
			? { headers: { authorization: `Bearer ${token}` } }
			: { cookies: { sid: session } }),
	});
}

const jql = encodeURIComponent(`project = ${key}`);

test.each([
	[`/api/search?jql=${jql}&startAt=${tooFar}`, false],
	[`/api/search?jql=${jql}&startAt=${MAX_OFFSET + 1}`, false],
	[`/api/search/issues?jql=${jql}&startAt=${tooFar}`, false],
	[`/api/global-search?q=paging&startAt=${tooFar}`, false],
	[`/api/projects/${key}/issues?offset=${tooFar}`, false],
	[`/api/notifications?offset=${tooFar}`, false],
	[`/rest/api/2/search?jql=${jql}&startAt=1e308`, true],
	[`/rest/api/2/search?jql=${jql}&startAt=${tooFar}`, true],
	[`/projects/${key}/issues?offset=${tooFar}`, false],
	[`/search?q=paging&startAt=${tooFar}`, false],
	[`/issues/?jql=${jql}&startAt=${tooFar}`, false],
])("an offset past the bound is a 400: %s", async (url, bearer) => {
	expect((await get(url, bearer)).statusCode).toBe(400);
});

test.each([
	[`/api/search?jql=${jql}&startAt=${MAX_OFFSET}`, false],
	[`/rest/api/2/search?jql=${jql}&startAt=${MAX_OFFSET}`, true],
	[`/projects/${key}/issues?offset=${MAX_OFFSET}`, false],
	[`/search?q=paging&startAt=${MAX_OFFSET}`, false],
])("the largest offset still answers: %s", async (url, bearer) => {
	expect((await get(url, bearer)).statusCode).toBe(200);
});
