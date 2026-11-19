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
const KEY = fixtureKey(run);
const ISSUE_COUNT = 120;
let app: TestApp;
let client: Client;
let sessionId: string;

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await createProjectFixture(client, {
		run,
		key: KEY,
		issues: Array.from({ length: ISSUE_COUNT }, (_, index) => ({
			summary: `Search issue ${index + 1}`,
		})),
	});
	app = buildServer();
	const session = await login(app, {
		sub: `sub-${run}`,
		username: `t-${run}-search`,
		name: "JQL User",
		groups: [],
	});
	sessionId = session.sessionId as string;
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

function get(
	url: string,
	cookies: Record<string, string> = { sid: sessionId },
) {
	return app.inject({ method: "GET", url, cookies });
}

function post(payload: unknown) {
	return app.inject({
		method: "POST",
		url: "/api/search",
		cookies: { sid: sessionId },
		headers: { "x-requested-with": "rvna" },
		payload: payload as object,
	});
}

test("GET returns a page of issues and the total", async () => {
	const response = await get(
		`/api/search?jql=${encodeURIComponent(`project = ${KEY} ORDER BY key ASC`)}&maxResults=2`,
	);
	expect(response.statusCode).toBe(200);
	const body = response.json();
	expect(body.total).toBe(ISSUE_COUNT);
	expect(body.startAt).toBe(0);
	expect(body.maxResults).toBe(2);
	expect(body.issues).toHaveLength(2);
	expect(body.issues[0]).toMatchObject({
		key: expect.stringMatching(new RegExp(`^${KEY}-\\d+$`)),
		summary: expect.any(String),
		type: expect.any(String),
		status: expect.any(String),
		created: expect.any(String),
		labels: expect.any(Array),
	});
	expect(body.issues.map((issue: { key: string }) => issue.key)).toEqual([
		`${KEY}-1`,
		`${KEY}-2`,
	]);
});

test("GET paginates with startAt", async () => {
	const first = await get(
		`/api/search?jql=${encodeURIComponent(`project = ${KEY} ORDER BY key ASC`)}&startAt=0&maxResults=1`,
	);
	const second = await get(
		`/api/search?jql=${encodeURIComponent(`project = ${KEY} ORDER BY key ASC`)}&startAt=1&maxResults=1`,
	);
	expect(first.json().issues[0].key).not.toBe(second.json().issues[0].key);
});

test("GET rejects a bad query with the Jira error list", async () => {
	const response = await get(
		`/api/search?jql=${encodeURIComponent("project = ")}`,
	);
	expect(response.statusCode).toBe(400);
	expect(response.json()).toEqual({
		errors: [
			"Error in the JQL Query: Expecting a value but got 'end of input'. (line 1, character 11)",
		],
	});
});

test("GET reports unknown fields and values", async () => {
	const field = await get(`/api/search?jql=${encodeURIComponent("nope = 1")}`);
	expect(field.statusCode).toBe(400);
	expect(field.json().errors[0]).toBe(
		"Error in the JQL Query: Field 'nope' does not exist or you do not have permission to view it. (line 1, character 1)",
	);

	const value = await get(
		`/api/search?jql=${encodeURIComponent("project = NOPE")}`,
	);
	expect(value.statusCode).toBe(400);
	expect(value.json().errors[0]).toBe(
		"Error in the JQL Query: The value 'NOPE' does not exist for the field 'project'. (line 1, character 11)",
	);
});

test("POST rejects impossible dates and offsets outside 100 years", async () => {
	const invalid = [
		'duedate >= "2026-02-30"',
		'duedate >= "2026-99-99"',
		"due >= startOfYear(-1000000000)",
		'updated >= "+999999999d"',
	];
	for (const jql of invalid) {
		const response = await post({ jql });
		expect(response.statusCode, jql).toBe(400);
		expect(response.json().errors, jql).toHaveLength(1);
		expect(response.json().errors[0], jql).toMatch(/^Error in the JQL Query: /);
	}

	const valid = [
		'duedate >= "2026-02-28"',
		'duedate >= "2026-12-31"',
		"due >= startOfYear(-99)",
		'updated >= "+99d"',
	];
	for (const jql of valid) {
		const response = await post({ jql });
		expect(response.statusCode, jql).toBe(200);
	}
});

test("POST accepts the same query for long inputs", async () => {
	const clauses = Array.from(
		{ length: 40 },
		(_, index) => `summary ~ "term${index}"`,
	);
	const jql = `project = ${KEY} AND (${clauses.join(" OR ")})`;
	expect(jql.length).toBeGreaterThan(500);

	const response = await post({ jql, startAt: 0, maxResults: 5 });
	expect(response.statusCode).toBe(200);
	expect(response.json().total).toBeGreaterThanOrEqual(0);

	const bad = await post({ jql: "project =" });
	expect(bad.statusCode).toBe(400);
	expect(bad.json().errors).toHaveLength(1);
});

test("POST requires the request header", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/api/search",
		cookies: { sid: sessionId },
		payload: { jql: `project = ${KEY}` },
	});
	expect(response.statusCode).toBe(403);
});

test("rejects unauthenticated requests", async () => {
	const response = await get(`/api/search?jql=project%20%3D%20${KEY}`, {});
	expect(response.statusCode).toBe(401);
});

test("caps maxResults at 100", async () => {
	const tooBig = await get(
		`/api/search?jql=${encodeURIComponent(`project = ${KEY}`)}&maxResults=1000`,
	);
	expect(tooBig.statusCode).toBe(400);

	const atLimit = await get(
		`/api/search?jql=${encodeURIComponent(`project = ${KEY}`)}&maxResults=100`,
	);
	expect(atLimit.statusCode).toBe(200);
	expect(atLimit.json().issues).toHaveLength(100);
	expect(atLimit.json().total).toBe(ISSUE_COUNT);
});
