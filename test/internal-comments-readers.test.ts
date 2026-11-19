import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { jqlTable } from "../src/lib/server/wiki/data.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const key = fixtureKey(run);
const secret = `zebra${run}`;
const editSecret = `quokka${run}`;

let app: TestApp;
let client: Client;
let agent: TestUser;
let customer: TestUser;
let seeded: SeedResult;
let commentId: string;
let editCommentId: string;

function viewer(user: TestUser): CurrentUser {
	return {
		id: user.id,
		username: user.username,
		displayName: `Test ${user.username}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};
}

async function insertComment(
	body: string,
	word: string,
	internal: boolean,
): Promise<string> {
	const result = await client.query<{ id: string }>(
		`insert into comments
		 (source_id, issue_id, author_id, body_html, body_source, created, updated, internal)
		 values ($1, $2, $3, $4, $5, now(), now(), $6) returning id`,
		[
			`test:${run}:comment:${word}`,
			seeded.issueIds[0],
			agent.id,
			`<p>${body}</p>`,
			body,
			internal,
		],
	);
	return result.rows[0]?.id as string;
}

async function search(session: string, jql: string) {
	const response = await injectAs(
		app,
		session,
		"GET",
		`/api/search?jql=${encodeURIComponent(jql)}&maxResults=10`,
	);
	expect(response.statusCode).toBe(200);
	return (response.json().issues as { key: string }[]).map(
		(issue) => issue.key,
	);
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	agent = await makeUser(run, "agent");
	customer = await makeUser(run, "customer");
	seeded = await createProjectFixture(client, {
		run,
		key,
		leadId: agent.id,
		admins: [agent.username],
		members: [customer.username],
		issues: [{ summary: "Internal comment target", reporterId: customer.id }],
	});
	await client.query(
		"insert into service_desks (source_id, project_id, portal_name) values ($1, $2, 'Desk')",
		[`test:${run}:desk`, seeded.projectId],
	);

	commentId = await insertComment(`internal note ${secret}`, "match", true);
	editCommentId = await insertComment(
		`internal note ${editSecret}`,
		"edit",
		true,
	);
	await insertComment("public reply", "public", false);
});

afterAll(async () => {
	if (client) {
		await client.query("delete from service_desks where source_id = $1", [
			`test:${run}:desk`,
		]);
		await dropProjectFixture(client, run);
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("JQL comment and text match only comments the viewer may read", async () => {
	const issueKey = seeded.issueKeys[0] as string;
	for (const field of ["comment", "text"]) {
		const jql = `project = ${key} AND ${field} ~ "${secret}"`;
		expect(await search(customer.session, jql)).toEqual([]);
		expect(await search(agent.session, jql)).toEqual([issueKey]);
	}
});

test("quick search does not match an internal comment for a non-agent", async () => {
	const issueKey = seeded.issueKeys[0] as string;
	const quick = (session: string) =>
		injectAs(
			app,
			session,
			"GET",
			`/api/quicksearch?q=${encodeURIComponent(secret)}`,
		);

	const customerResult = await quick(customer.session);
	const agentResult = await quick(agent.session);
	expect(customerResult.statusCode).toBe(200);
	expect(agentResult.statusCode).toBe(200);
	expect(customerResult.json().issues).toEqual([]);
	expect(
		(agentResult.json().issues as { key: string }[]).map((issue) => issue.key),
	).toEqual([issueKey]);
});

test("a non-agent gets 404 for an internal comment by its known id", async () => {
	const url = `/api/issues/${seeded.issueKeys[0]}/comments/${editCommentId}`;

	const edited = await injectAs(app, customer.session, "PATCH", url, {
		body: "<p>tampered</p>",
	});
	expect(edited.statusCode).toBe(404);
	const deleted = await injectAs(app, customer.session, "DELETE", url);
	expect(deleted.statusCode).toBe(404);

	const agentEdit = await injectAs(app, agent.session, "PATCH", url, {
		body: `<p>agent edit ${editSecret}</p>`,
	});
	expect(agentEdit.statusCode).toBe(200);
	expect(agentEdit.json().bodyHtml).toContain(editSecret);
});

test("CSV export does not export an issue matched only by an internal comment", async () => {
	const jql = `project = ${key} AND text ~ "${secret}"`;
	const url = `/api/search/export?jql=${encodeURIComponent(jql)}&columns=key`;
	const issueKey = seeded.issueKeys[0] as string;

	const customerCsv = await injectAs(app, customer.session, "GET", url);
	expect(customerCsv.statusCode).toBe(200);
	expect(customerCsv.body).not.toContain(issueKey);

	const agentCsv = await injectAs(app, agent.session, "GET", url);
	expect(agentCsv.statusCode).toBe(200);
	expect(agentCsv.body).toContain(issueKey);
});

test("the wiki issue list macro does not list an issue matched only by an internal comment", async () => {
	const jql = `project = ${key} AND comment ~ "${secret}"`;
	const issueKey = seeded.issueKeys[0] as string;

	const customerTable = await jqlTable(jql, ["key"], viewer(customer), 10);
	expect("error" in customerTable).toBe(false);
	if (!("error" in customerTable)) expect(customerTable.rows).toEqual([]);

	const agentTable = await jqlTable(jql, ["key"], viewer(agent), 10);
	expect("error" in agentTable).toBe(false);
	if (!("error" in agentTable)) {
		expect(agentTable.rows.map((row) => row.key)).toEqual([issueKey]);
	}
});

test("the internal comment is still readable to an agent", async () => {
	const response = await injectAs(
		app,
		agent.session,
		"GET",
		`/api/issues/${seeded.issueKeys[0]}/comments`,
	);
	expect(response.statusCode).toBe(200);
	expect(JSON.stringify(response.json())).toContain(secret);
	expect(commentId).toBeTruthy();
});
