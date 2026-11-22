import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { withStatementTimeout } from "../src/lib/server/jql/timeout.ts";
import { boards, fieldOptions, fields } from "../src/lib/server/schema.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
	type SeedResult,
} from "./fixtures/project.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const KEY = fixtureKey(run);
const HIDDEN_FIELD = "customfield_99078";
const VISIBLE_FIELD = "customfield_99077";
const BROKEN_NUMBER_FIELD = "customfield_99079";
const INTERNAL_RANK_FIELD = "customfield_20004";
const BROKEN_NUMBER_ID = "99079";
const TAG = `t-${run}`;

let app: TestApp;
let client: Client;
let fixture: SeedResult;
let mainSession: string;
let adminSession: string;
let victimSession: string;
let mainId: string;
let victimId: string;
let boardId: string;
let rapidViewId: number;

const enc = encodeURIComponent;

function get(url: string, session: string = mainSession) {
	return app.inject({ method: "GET", url, cookies: { sid: session } });
}

function send(
	method: "POST" | "PATCH" | "DELETE" | "PUT",
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

function multipart(files: { name: string; bytes: Buffer }[]) {
	const boundary = `----rvna${randomUUID()}`;
	const chunks: Buffer[] = [];
	for (const file of files) {
		chunks.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
			),
			file.bytes,
			Buffer.from("\r\n"),
		);
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`));
	return {
		body: Buffer.concat(chunks),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const main = await login(app, {
		sub: `sub-${run}-main`,
		username: `${TAG}-main`,
		name: "Main User",
		email: `${TAG}-main@example.test`,
		groups: [],
	});
	mainSession = main.sessionId as string;

	const admin = await login(app, {
		sub: `sub-${run}-admin`,
		username: `${TAG}-admin`,
		name: "Admin User",
		email: `${TAG}-admin@example.test`,
		groups: [adminGroup()],
	});
	adminSession = admin.sessionId as string;

	const victim = await login(app, {
		sub: `sub-${run}-victim`,
		username: `${TAG}-victim`,
		name: "Victim Person",
		email: `${TAG}-victim@example.test`,
		groups: [],
	});
	victimSession = victim.sessionId as string;

	mainId = (await get("/api/me")).json().id as string;
	victimId = (await get("/api/me", victimSession)).json().id as string;

	fixture = await createProjectFixture(client, {
		run,
		key: KEY,
		members: [`${TAG}-main`, `${TAG}-victim`],
		issues: [
			{
				summary: "Security issue one",
				assigneeId: mainId,
				reporterId: victimId,
			},
			{ summary: "Security issue two", assigneeId: mainId },
			{ summary: "Security issue three" },
		],
	});

	await db.insert(fields).values([
		{
			sourceId: HIDDEN_FIELD,
			name: `Hidden service desk ${run}`,
			type: "string",
			customKey: "com.atlassian.servicedesk:hidden",
		},
		{
			sourceId: VISIBLE_FIELD,
			name: `Visible text ${run}`,
			type: "string",
		},
		{
			sourceId: BROKEN_NUMBER_FIELD,
			name: `Broken number ${run}`,
			type: "number",
		},
		{
			sourceId: INTERNAL_RANK_FIELD,
			name: `Rank ${run}`,
			type: "string",
			customKey: "com.pyxis.greenhopper.jira:gh-lexo-rank",
		},
	]);
	const fieldRows = await db
		.select({ id: fields.id, sourceId: fields.sourceId })
		.from(fields)
		.where(
			sql`${fields.sourceId} in (${HIDDEN_FIELD}, ${VISIBLE_FIELD}, ${BROKEN_NUMBER_FIELD})`,
		);
	for (const field of fieldRows) {
		if (field.sourceId === BROKEN_NUMBER_FIELD) continue;
		await db.insert(fieldOptions).values({
			sourceId: `${field.sourceId}:option`,
			fieldId: field.id,
			value:
				field.sourceId === HIDDEN_FIELD ? "Secret Option" : "Visible Option",
		});
	}

	await client.query(`update issues set custom = $2::jsonb where id = $1`, [
		fixture.issueIds[0],
		JSON.stringify({
			[HIDDEN_FIELD]: "hidden-secret",
			[VISIBLE_FIELD]: "Visible Value",
			[BROKEN_NUMBER_FIELD]: "not-a-number",
		}),
	]);

	await client.query(
		"update users set avatar_url = $1 where id = any($2::uuid[])",
		["https://tracker.example.test/avatar.png", [mainId, victimId]],
	);

	rapidViewId = 900_000 + Math.floor(Math.random() * 90_000);
	const [board] = await db
		.insert(boards)
		.values({
			rapidViewId,
			sourceId: `${run}:board`,
			name: `Security board ${run}`,
			type: "scrum",
			filterJql: `project = ${KEY}`,
			ownerId: mainId,
			configImported: false,
		})
		.returning({ id: boards.id });
	boardId = board.id;
});

afterAll(async () => {
	if (client) {
		if (boardId)
			await client.query("delete from boards where id = $1", [boardId]);
		await dropProjectFixture(client, run);
		await client.query("delete from fields where source_id = any($1::text[])", [
			[HIDDEN_FIELD, VISIBLE_FIELD, BROKEN_NUMBER_FIELD, INTERNAL_RANK_FIELD],
		]);
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

// --- 1. hidden custom fields ------------------------------------------------

test("hidden custom fields cannot be selected as navigator or CSV columns", async () => {
	const jql = enc(`project = ${KEY}`);
	const navigator = await get(
		`/api/search/issues?jql=${jql}&columns=${enc(`cf:${HIDDEN_FIELD}`)}`,
	);
	expect(navigator.statusCode).toBe(400);
	expect(navigator.body).not.toContain("hidden-secret");

	const internal = await get(
		`/api/search/issues?jql=${jql}&columns=${enc(`cf:${INTERNAL_RANK_FIELD}`)}`,
	);
	expect(internal.statusCode).toBe(400);

	const exported = await get(
		`/api/search/export?jql=${jql}&columns=${enc(`cf:${HIDDEN_FIELD}`)}`,
	);
	expect(exported.statusCode).toBe(400);
	expect(exported.body).not.toContain("hidden-secret");
});

test("hidden custom fields are rejected by JQL and not suggested", async () => {
	const search = await get(
		`/api/search?jql=${enc('cf[99078] = "hidden-secret"')}`,
	);
	expect(search.statusCode).toBe(400);
	expect(search.json().errors[0]).toContain(
		"does not exist or you do not have permission",
	);

	const suggest = await get(
		`/api/jql/suggest?field=${enc("cf[99078]")}&prefix=Sec`,
	);
	expect(suggest.statusCode).toBe(200);
	expect(suggest.json().values).not.toContain("Secret Option");
});

test("visible custom fields still work in the navigator, CSV, JQL and suggest", async () => {
	const jql = enc(`project = ${KEY}`);
	const navigator = await get(
		`/api/search/issues?jql=${enc(`project = ${KEY} ORDER BY key ASC`)}&columns=${enc(`cf:${VISIBLE_FIELD}`)}`,
	);
	expect(navigator.statusCode).toBe(200);
	expect(navigator.json().issues[0].custom[VISIBLE_FIELD]).toBe(
		"Visible Value",
	);

	const exported = await get(
		`/api/search/export?jql=${jql}&columns=${enc(`cf:${VISIBLE_FIELD}`)}`,
	);
	expect(exported.statusCode).toBe(200);
	expect(exported.body).toContain("Visible Value");

	const search = await get(
		`/api/search?jql=${enc('cf[99077] = "Visible Value"')}`,
	);
	expect(search.statusCode).toBe(200);
	expect(search.json().total).toBeGreaterThan(0);

	const suggest = await get(
		`/api/jql/suggest?field=${enc("cf[99077]")}&prefix=Vis`,
	);
	expect(suggest.statusCode).toBe(200);
	expect(suggest.json().values).toContain("Visible Option");
});

// --- 2. OIDC transactions ---------------------------------------------------

test("oidc_transactions.created_at is indexed", async () => {
	const result = await client.query<{ indexname: string }>(
		"select indexname from pg_indexes where tablename = 'oidc_transactions'",
	);
	expect(result.rows.map((row) => row.indexname)).toContain(
		"oidc_transactions_created_at_idx",
	);
});

test("login transactions are capped per client IP", async () => {
	const marker = `/cap-${run}`;
	try {
		for (let index = 0; index < 30; index++) {
			const response = await app.inject({
				method: "GET",
				url: `/auth/login?returnTo=${enc(`${marker}-${index}`)}`,
			});
			expect(response.statusCode).toBe(302);
		}

		const groups = await client.query<{
			client_ip: string | null;
			count: number;
		}>(
			`select client_ip, count(*)::int as count
		 from oidc_transactions
		 where client_ip is not null
		 group by client_ip`,
		);
		for (const row of groups.rows) {
			expect(row.count).toBeLessThanOrEqual(20);
		}
		const ours = await client.query<{ count: number }>(
			"select count(*)::int as count from oidc_transactions where return_to like $1",
			[`${marker}-%`],
		);
		expect(ours.rows[0]?.count).toBeLessThanOrEqual(20);
	} finally {
		await client.query(
			"delete from oidc_transactions where return_to like $1",
			[`${marker}-%`],
		);
	}
});

test("expired transactions are cleaned at most once a minute", async () => {
	const marker = `/expired-${run}`;
	await client.query(
		`insert into oidc_transactions
		 (id_hash, state, nonce, code_verifier, return_to, created_at)
		 values ($1, 'state', 'nonce', 'verifier', $2, now() - interval '11 minutes')`,
		[randomUUID(), marker],
	);
	try {
		const response = await app.inject({
			method: "GET",
			url: `/auth/login?returnTo=${enc(`/after-${run}`)}`,
		});
		expect(response.statusCode).toBe(302);
		const kept = await client.query(
			"select 1 from oidc_transactions where return_to = $1",
			[marker],
		);
		expect(kept.rowCount).toBe(1);
	} finally {
		await client.query("delete from oidc_transactions where return_to = $1", [
			marker,
		]);
	}
});

// --- 3. attachment upload cap ----------------------------------------------

test("an upload over the request-wide cap is a 413", async () => {
	const payload = multipart([
		{ name: "first.bin", bytes: Buffer.alloc(600 * 1024, 1) },
		{ name: "second.bin", bytes: Buffer.alloc(600 * 1024, 2) },
	]);
	const response = await app.inject({
		method: "POST",
		url: `/api/issues/${fixture.issueKeys[0]}/attachments`,
		cookies: { sid: mainSession },
		headers: {
			"x-requested-with": "rvna",
			"content-type": payload.contentType,
		},
		payload: payload.body,
	});
	expect(response.statusCode).toBe(413);
	expect(response.json().error).toContain("1 MB");
});

test("an upload under the request-wide cap still succeeds", async () => {
	const payload = multipart([
		{ name: "small.bin", bytes: Buffer.alloc(600 * 1024, 3) },
	]);
	const response = await app.inject({
		method: "POST",
		url: `/api/issues/${fixture.issueKeys[0]}/attachments`,
		cookies: { sid: mainSession },
		headers: {
			"x-requested-with": "rvna",
			"content-type": payload.contentType,
		},
		payload: payload.body,
	});
	expect(response.statusCode).toBe(201);
	expect(response.json()[0].size).toBe(600 * 1024);
});

// --- 4. JQL complexity ------------------------------------------------------

test("JQL longer than 10,000 characters is rejected", async () => {
	const jql = `project = ${KEY} AND ${'summary ~ "x" AND '.repeat(700)}summary ~ "x"`;
	expect(jql.length).toBeGreaterThan(10_000);
	const response = await get(`/api/search?jql=${enc(jql)}`);
	expect(response.statusCode).toBe(400);
	expect(response.json().errors[0]).toContain("10000");
});

test("JQL with more than 200 clauses is rejected", async () => {
	const clauses = Array.from({ length: 205 }, () => 'summary ~ "x"');
	const jql = `project = ${KEY} AND (${clauses.join(" OR ")})`;
	expect(jql.length).toBeLessThan(10_000);
	const response = await get(`/api/search?jql=${enc(jql)}`);
	expect(response.statusCode).toBe(400);
	expect(response.json().errors[0]).toContain("200");
});

test("query groups run with a local statement timeout", async () => {
	await expect(
		withStatementTimeout(async (tx) => {
			await tx.execute(sql`select pg_sleep(0.2)`);
		}, 50),
	).rejects.toMatchObject({ cause: { code: "57014" } });
});

test("an invalid statement timeout is rejected before it reaches SQL", async () => {
	for (const timeoutMs of [
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		1e21,
	]) {
		await expect(
			withStatementTimeout(async () => {}, timeoutMs),
		).rejects.toBeInstanceOf(RangeError);
	}
});

test("JQL nested deeper than 20 levels is rejected", async () => {
	const jql = `${"(".repeat(21)}project = ${KEY}${")".repeat(21)}`;
	const response = await get(`/api/search?jql=${enc(jql)}`);
	expect(response.statusCode).toBe(400);
	expect(response.json().errors[0]).toContain("20");
});

// --- 5. internal error leaks ------------------------------------------------

test("unexpected database errors return a generic 500 without SQL", async () => {
	const response = await get(
		`/api/search?jql=${enc(`project = ${KEY} AND cf[${BROKEN_NUMBER_ID}] > 0`)}`,
	);
	expect(response.statusCode).toBe(500);
	expect(response.json()).toEqual({ error: "Internal server error" });
	expect(response.body).not.toContain("Failed query");
	expect(response.body).not.toContain("select");
});

test("invalid UUID route parameters are a 400 validation error", async () => {
	const response = await get("/api/avatars/users/not-a-uuid");
	expect(response.statusCode).toBe(400);
	expect(response.json().message).toContain("Invalid UUID");
});

// --- 6. email enumeration ---------------------------------------------------

test("non-admin user autocomplete omits email", async () => {
	const response = await get(`/api/users?query=${enc(`${TAG}-main`)}`);
	expect(response.statusCode).toBe(200);
	expect(response.json()[0]).not.toHaveProperty("email");
});

test("admin user autocomplete still includes email", async () => {
	const response = await get(
		`/api/users?query=${enc(`${TAG}-admin`)}`,
		adminSession,
	);
	expect(response.statusCode).toBe(200);
	expect(response.json()[0].email).toBe(`${TAG}-admin@example.test`);
});

test("user autocomplete does not match on email for a non-admin", async () => {
	const response = await get(`/api/users?query=${enc(`${TAG}-victim@`)}`);
	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual([]);
});

test("a profile shows the email to the owner and an administrator only", async () => {
	const url = `/api/users/${enc(`${TAG}-victim`)}/profile`;
	const email = `${TAG}-victim@example.test`;
	expect((await get(url)).json().email).toBeNull();
	expect((await get(url, victimSession)).json().email).toBe(email);
	expect((await get(url, adminSession)).json().email).toBe(email);
});

test("a profile lists the groups to the owner and an administrator only", async () => {
	const url = `/api/users/${enc(`${TAG}-victim`)}/profile`;
	const group = `${TAG}-profile-group`;
	const { rows } = await pool.query<{ id: string }>(
		"insert into groups (name) values ($1) returning id",
		[group],
	);
	await pool.query(
		"insert into user_groups (user_id, group_id, source) values ($1, $2, 'local')",
		[victimId, rows[0]?.id],
	);
	try {
		expect((await get(url)).json().groups).toEqual([]);
		expect((await get(url, victimSession)).json().groups).toEqual([group]);
		expect((await get(url, adminSession)).json().groups).toEqual([group]);
	} finally {
		await pool.query("delete from groups where id = $1", [rows[0]?.id]);
	}
});

// --- 7. avatar URLs ---------------------------------------------------------

test("every API response serves avatars through the app route", async () => {
	const me = await get("/api/me");
	expect(me.json().avatarUrl).toBe(`/api/avatars/users/${mainId}`);

	const users = await get(`/api/users?query=${enc(`${TAG}-main`)}`);
	expect(users.json()[0].avatarUrl).toBe(`/api/avatars/users/${mainId}`);

	const issue = await get(`/api/issues/${fixture.issueKeys[0]}`);
	expect(issue.json().assignee.avatarUrl).toBe(`/api/avatars/users/${mainId}`);
	expect(issue.json().reporter.avatarUrl).toBe(
		`/api/avatars/users/${victimId}`,
	);

	const watched = await send(
		"POST",
		`/api/issues/${fixture.issueKeys[0]}/watchers`,
		mainSession,
		{ userId: mainId },
	);
	expect(watched.statusCode).toBe(200);
	const watchers = await get(`/api/issues/${fixture.issueKeys[0]}/watchers`);
	expect(
		watchers.json().watchers.find((user: { id: string }) => user.id === mainId)
			.avatarUrl,
	).toBe(`/api/avatars/users/${mainId}`);

	const boardList = await get("/api/boards");
	const board = boardList
		.json()
		.find((item: { rapidViewId: number }) => item.rapidViewId === rapidViewId);
	expect(board.owner.avatarUrl).toBe(`/api/avatars/users/${mainId}`);

	const backlog = await get(`/api/boards/${rapidViewId}/backlog`);
	expect(backlog.statusCode).toBe(200);
	const card = backlog
		.json()
		.backlog.issues.find(
			(issue: { key: string }) => issue.key === fixture.issueKeys[0],
		);
	expect(card.assignee.avatarUrl).toBe(`/api/avatars/users/${mainId}`);

	const comment = await send(
		"POST",
		`/api/issues/${fixture.issueKeys[0]}/comments`,
		victimSession,
		{ body: "<p>avatar check</p>" },
	);
	expect(comment.statusCode).toBe(201);
	const notifications = await get("/api/notifications");
	const notification = notifications
		.json()
		.notifications.find(
			(item: { actor: { id: string } | null }) => item.actor?.id === victimId,
		);
	expect(notification.actor.avatarUrl).toBe(`/api/avatars/users/${victimId}`);
});

// --- 8. mention spoofing ----------------------------------------------------

test("the sanitiser renders the mention label from the user id", async () => {
	const forged = `<p>Ping <a class="user-hover" data-user-id="${victimId}">@Admin</a></p>`;
	const created = await send(
		"POST",
		`/api/issues/${fixture.issueKeys[1]}/comments`,
		mainSession,
		{ body: forged },
	);
	expect(created.statusCode).toBe(201);
	expect(created.json().bodyHtml).toContain("@Victim Person");
	expect(created.json().bodyHtml).not.toContain("@Admin");

	const notifications = await get("/api/notifications", victimSession);
	expect(
		notifications
			.json()
			.notifications.some(
				(item: { kind: string }) => item.kind === "mentioned",
			),
	).toBe(true);
});
