import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runMigrations } from "../src/lib/server/db.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const tag = `t-${run}`;
const projectKey = fixtureKey(run);
const assigners = `${tag}-assigners`;
const assignable = `${tag}-assignable`;

let app: TestApp;
let client: Client;
let fixture: SeedResult;
let schemeId: string;
let editorSession: string;
let assignerSession: string;
let assignableId: string;
let outsiderId: string;

function inject(
	method: "GET" | "POST" | "PATCH",
	url: string,
	session: string,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: { sid: session },
		headers: { "x-requested-with": "rvna" },
		payload: payload as never,
	});
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const editor = await login(app, {
		sub: `${tag}-editor`,
		username: `${tag}-editor`,
		name: "Editor",
		groups: [],
	});
	editorSession = editor.sessionId as string;
	const assigner = await login(app, {
		sub: `${tag}-assigner`,
		username: `${tag}-assigner`,
		name: "Assigner",
		groups: [assigners],
	});
	assignerSession = assigner.sessionId as string;
	await login(app, {
		sub: `${tag}-assignable`,
		username: `${tag}-assignable`,
		name: "Assignable User",
		groups: [assignable],
	});
	await login(app, {
		sub: `${tag}-outsider`,
		username: `${tag}-outsider`,
		name: "Outsider",
		groups: [],
	});

	const ids = await client.query<{ id: string; username: string }>(
		"select id, username from users where username like $1",
		[`${tag}-%`],
	);
	const idOf = (username: string) => {
		const row = ids.rows.find((candidate) => candidate.username === username);
		if (!row) throw new Error(`Missing user ${username}`);
		return row.id;
	};
	assignableId = idOf(`${tag}-assignable`);
	outsiderId = idOf(`${tag}-outsider`);

	fixture = await createProjectFixture(client, {
		run,
		key: projectKey,
		name: `Assignee permissions ${run}`,
		issues: [
			{ summary: "Assigned issue", assigneeId: assignableId },
			{ summary: "Second issue" },
		],
	});

	const scheme = await client.query<{ id: string }>(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb) returning id`,
		[
			`${tag}-scheme`,
			`Assignee scheme ${run}`,
			JSON.stringify([fixture.projectId]),
		],
	);
	schemeId = scheme.rows[0].id;
	const grants = [
		["BROWSE_PROJECTS", "anyone", null],
		["CREATE_ISSUES", "anyone", null],
		["EDIT_ISSUES", "anyone", null],
		["ASSIGN_ISSUES", "group", assigners],
		["ASSIGNABLE_USER", "group", assignable],
	] as const;
	for (const [permission, holderType, parameter] of grants) {
		await client.query(
			`insert into permission_grants
			 (source_id, scheme_id, permission_key, holder_type, holder_parameter, raw)
			 values ($1, $2, $3, $4, $5, '{}'::jsonb)`,
			[
				`${tag}-grant-${permission}`,
				schemeId,
				permission,
				holderType,
				parameter,
			],
		);
	}
});

afterAll(async () => {
	if (client) {
		if (schemeId) {
			await client.query("delete from permission_schemes where id = $1", [
				schemeId,
			]);
		}
		if (fixture) await dropProjectFixture(client, run);
		await cleanupTestData(run);
		await client.end();
	}
});

test("an editor without ASSIGN_ISSUES may repeat the current assignee", async () => {
	const response = await inject(
		"PATCH",
		`/api/issues/${projectKey}-1`,
		editorSession,
		{ assignee: assignableId },
	);
	expect(response.statusCode).toBe(200);
	expect(response.json().assignee.id).toBe(assignableId);
});

test("an editor without ASSIGN_ISSUES cannot change the assignee", async () => {
	const response = await inject(
		"PATCH",
		`/api/issues/${projectKey}-1`,
		editorSession,
		{ assignee: outsiderId },
	);
	expect(response.statusCode).toBe(403);
	expect(response.json().error).toContain("ASSIGN_ISSUES");
});

test("an assigner cannot assign a user without ASSIGNABLE_USER", async () => {
	const response = await inject(
		"PATCH",
		`/api/issues/${projectKey}-1`,
		assignerSession,
		{ assignee: outsiderId },
	);
	expect(response.statusCode).toBe(403);
	expect(response.json().error).toContain("ASSIGNABLE_USER");
});

test("an assigner may assign an assignable user", async () => {
	const response = await inject(
		"PATCH",
		`/api/issues/${projectKey}-2`,
		assignerSession,
		{ assignee: assignableId },
	);
	expect(response.statusCode).toBe(200);
	expect(response.json().assignee.id).toBe(assignableId);
});

test("creating with an assignee requires ASSIGN_ISSUES", async () => {
	const response = await inject("POST", "/api/issues", editorSession, {
		project: projectKey,
		type: fixture.typeIds.task,
		summary: `Editor create ${run}`,
		assignee: assignableId,
	});
	expect(response.statusCode).toBe(403);
	expect(response.json().error).toContain("ASSIGN_ISSUES");
});

test("creating without an assignee still works without ASSIGN_ISSUES", async () => {
	const response = await inject("POST", "/api/issues", editorSession, {
		project: projectKey,
		type: fixture.typeIds.task,
		summary: `Editor create unassigned ${run}`,
	});
	expect(response.statusCode).toBe(201);
	expect(response.json().assignee).toBeNull();
});
