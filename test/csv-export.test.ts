import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { csvCell } from "../src/lib/server/navigator/service.ts";
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
let userId: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const loggedIn = await login(app, {
		sub: `sub-${run}`,
		username: `t-${run}-csv`,
		name: "CSV User",
		groups: [],
	});
	session = loggedIn.sessionId as string;
	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: session },
	});
	userId = me.json().id;

	fixture = await createProjectFixture(client, {
		run,
		key,
		issues: [
			{
				summary: "=1+1 formula",
				priority: "high",
				assigneeId: userId,
				labels: ["alpha", "beta"],
			},
			{
				summary: 'He said "hi", then left',
				priority: "low",
			},
			{
				summary: "+34 dialling code",
				priority: null,
			},
			{
				summary: "@handle mention",
				priority: "low",
			},
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

function exportCsv(columns: string, jql = `project = ${key} ORDER BY key ASC`) {
	return app.inject({
		method: "GET",
		url: `/api/search/export?jql=${encodeURIComponent(jql)}&columns=${encodeURIComponent(columns)}`,
		cookies: { sid: session },
	});
}

test("the export returns the requested columns as CSV", async () => {
	const response = await exportCsv("key,summary,assignee,labels");
	expect(response.statusCode).toBe(200);
	expect(response.headers["content-type"]).toContain("text/csv");
	expect(response.headers["content-disposition"]).toContain("attachment;");

	const lines = response.body.split("\r\n").filter((line) => line !== "");
	expect(lines[0]).toBe("Key,Summary,Assignee,Labels");
	expect(lines).toHaveLength(5);

	const first = lines[1] as string;
	expect(first).toContain(`${key}-1,`);
	expect(first).toContain("'=1+1 formula");
	expect(first).toContain("CSV User");
	expect(first).toContain("alpha, beta");
});

test("cells that would run as a formula are prefixed and quoted safely", async () => {
	const response = await exportCsv("summary");
	const lines = response.body.split("\r\n").filter((line) => line !== "");

	expect(lines[1]).toBe("'=1+1 formula");
	expect(lines[2]).toBe('"He said ""hi"", then left"');
	expect(lines[3]).toBe("'+34 dialling code");
	expect(lines[4]).toBe("'@handle mention");
});

test("an empty value stays an empty cell", async () => {
	const response = await exportCsv("key,assignee,resolution");
	const lines = response.body.split("\r\n").filter((line) => line !== "");
	expect(lines[2]).toBe(`${key}-2,,`);
});

test("the export stops at 1000 rows", async () => {
	const bulkKey = `${key}B`;
	const project = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'software', 0) returning id`,
		[`fixture:${run}:bulk-project`, bulkKey, `Bulk ${run}`],
	);
	const projectId = project.rows[0]?.id as string;
	await client.query(
		`insert into issues (
			source_id, project_id, number, key, type_id, status_id, summary,
			created, updated
		 )
		 select
			$1 || ':' || value, $2, value, $3 || '-' || value, $4, $5,
			'Bulk issue ' || value, now(), now()
		 from generate_series(1, 1001) as value`,
		[
			`fixture:${run}:bulk-issue`,
			projectId,
			bulkKey,
			fixture.typeIds.task,
			fixture.statusIds.todo,
		],
	);

	try {
		const response = await exportCsv(
			"key",
			`project = ${bulkKey} ORDER BY key ASC`,
		);
		expect(response.statusCode).toBe(200);
		const lines = response.body.split("\r\n").filter((line) => line !== "");
		expect(lines).toHaveLength(1001);
		expect(lines[0]).toBe("Key");
		expect(lines[1]).toBe(`${bulkKey}-1`);
		expect(lines[1000]).toBe(`${bulkKey}-1000`);
	} finally {
		await client.query("delete from projects where id = $1", [projectId]);
	}
}, 30_000);

test("a broken query is refused before the stream starts", async () => {
	const response = await exportCsv("key", "project = ");
	expect(response.statusCode).toBe(400);
	expect(response.json().error).toContain("Error in the JQL Query");
});

test("an unknown field is refused before the stream starts", async () => {
	const response = await exportCsv(
		"key",
		`project = ${key} AND nosuchfield = 1`,
	);
	expect(response.statusCode).toBe(400);
	expect(response.json().error).toContain("does not exist");
});

test("the export requires a session", async () => {
	const response = await app.inject({
		method: "GET",
		url: `/api/search/export?jql=${encodeURIComponent(`project = ${key}`)}`,
	});
	expect(response.statusCode).toBe(401);
});

test("the filter name reaches the download filename", async () => {
	const name = `my filter ${randomUUID().slice(0, 4)}`;
	const response = await app.inject({
		method: "GET",
		url: `/api/search/export?jql=${encodeURIComponent(`project = ${key}`)}&columns=key&name=${encodeURIComponent(name)}`,
		cookies: { sid: session },
	});
	expect(response.headers["content-disposition"]).toBe(
		`attachment; filename="${name}.csv"; filename*=UTF-8''${encodeURIComponent(`${name}.csv`)}`,
	);
});

test("a filter name outside Latin-1 still downloads", async () => {
	const response = await app.inject({
		method: "GET",
		url: `/api/search/export?jql=${encodeURIComponent(`project = ${key}`)}&columns=key&name=${encodeURIComponent("Звіт 日本")}`,
		cookies: { sid: session },
	});
	expect(response.statusCode).toBe(200);
	expect(response.headers["content-disposition"]).toBe(
		`attachment; filename="____ __.csv"; filename*=UTF-8''${encodeURIComponent("Звіт 日本.csv")}`,
	);
});

test("leading whitespace or control characters cannot smuggle a formula", () => {
	expect(csvCell("\t=cmd|' /C calc'!A0")).toBe("\"'\t=cmd|' /C calc'!A0\"");
	expect(csvCell("\r=1+1")).toBe('"\'\r=1+1"');
	expect(csvCell(" \t=1+1")).toBe('"\' \t=1+1"');
	expect(csvCell("plain\ttab")).toBe('"plain\ttab"');
});
