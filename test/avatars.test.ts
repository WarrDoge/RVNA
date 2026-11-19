import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
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
let userId: string;
let fixture: SeedResult;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const loggedIn = await login(app, {
		sub: `sub-${run}`,
		username: `t-${run}-avatar`,
		name: "Avatar User",
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
		members: [`t-${run}-avatar`],
		issues: [{ summary: "Avatar issue" }],
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

function get(url: string, cookies: Record<string, string> = { sid: session }) {
	return app.inject({ method: "GET", url, cookies });
}

test("a user without a stored image gets a generated SVG", async () => {
	const response = await get(`/api/avatars/users/${userId}`);
	expect(response.statusCode).toBe(200);
	expect(response.headers["content-type"]).toContain("image/svg+xml");
	expect(response.headers["content-security-policy"]).toBe("sandbox");
	expect(response.headers["x-content-type-options"]).toBe("nosniff");
	expect(response.body).toContain("<svg");
	expect(response.body).toContain("AU");
});

test("the generated SVG cannot run script", async () => {
	await client.query("update users set display_name = $1 where id = $2", [
		'<script>alert("x")</script>',
		userId,
	]);
	try {
		const response = await get(`/api/avatars/users/${userId}`);
		expect(response.statusCode).toBe(200);
		expect(response.body).not.toContain("<script");
		expect(response.body).not.toContain("</script");
		expect(response.body).not.toMatch(/\son[a-z]+=/i);
		expect(response.body).not.toContain("foreignObject");
		expect(response.body).not.toContain("javascript:");
		expect(response.body).toContain("&lt;");
	} finally {
		await client.query("update users set display_name = $1 where id = $2", [
			"Avatar User",
			userId,
		]);
	}
});

test("a project avatar is the first letter on a rounded square", async () => {
	const response = await get(`/api/avatars/projects/${fixture.projectId}`);
	expect(response.statusCode).toBe(200);
	expect(response.headers["content-type"]).toContain("image/svg+xml");
	expect(response.headers["content-security-policy"]).toBe("sandbox");
	expect(response.body).toContain("<rect");
	expect(response.body).toContain(`>${key[0]}</text>`);
});

test("a project avatar letter skips leading punctuation", async () => {
	await client.query("update projects set name = $1 where id = $2", [
		"[Bracket] project",
		fixture.projectId,
	]);
	const response = await get(`/api/avatars/projects/${fixture.projectId}`);
	expect(response.body).toContain(">B</text>");
});

test("a stored image is served instead of the generated one", async () => {
	const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const relative = `users/${userId}.png`;
	await mkdir(join(process.env.AVATARS_DIR as string, "users"), {
		recursive: true,
	});
	await writeFile(join(process.env.AVATARS_DIR as string, relative), bytes);
	await client.query("update users set avatar_file = $1 where id = $2", [
		relative,
		userId,
	]);

	try {
		const response = await get(`/api/avatars/users/${userId}`);
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toBe("image/png");
		expect(response.headers["x-content-type-options"]).toBe("nosniff");
		expect(response.rawPayload.equals(bytes)).toBe(true);
	} finally {
		await client.query("update users set avatar_file = null where id = $1", [
			userId,
		]);
	}
});

test("an unknown avatar is a 404", async () => {
	const response = await get(
		"/api/avatars/users/00000000-0000-4000-8000-000000000000",
	);
	expect(response.statusCode).toBe(404);
});

test("avatar endpoints require a session", async () => {
	const response = await app.inject({
		method: "GET",
		url: `/api/avatars/users/${userId}`,
	});
	expect(response.statusCode).toBe(401);
});

test("watcher responses use the local avatar endpoint", async () => {
	await client.query(
		`insert into watchers (source_id, issue_id, user_id)
		 values ($1, $2, $3)`,
		[`fixture:${run}:watcher`, fixture.issueIds[0], userId],
	);
	await client.query("update users set avatar_url = $1 where id = $2", [
		"https://jira.example/secure/useravatar?ownerId=imported",
		userId,
	]);

	try {
		const response = await get(`/api/issues/${fixture.issueKeys[0]}/watchers`);
		expect(response.statusCode).toBe(200);
		expect(response.json().watchers).toEqual([
			expect.objectContaining({
				id: userId,
				avatarUrl: `/api/avatars/users/${userId}`,
			}),
		]);
	} finally {
		await client.query(
			"delete from watchers where issue_id = $1 and user_id = $2",
			[fixture.issueIds[0], userId],
		);
		await client.query("update users set avatar_url = null where id = $1", [
			userId,
		]);
	}
});

test("the API only emits RVNA avatar URLs", async () => {
	const me = await get("/api/me");
	expect(me.json().avatarUrl).toBe(`/api/avatars/users/${userId}`);

	const projects = await get("/api/projects");
	const listed = projects
		.json()
		.find((project: { key: string }) => project.key === key);
	expect(listed.avatarUrl).toBe(`/api/avatars/projects/${fixture.projectId}`);
	expect(listed.lead).toBeNull();

	const issue = await get(`/api/issues/${fixture.issueKeys[0]}`);
	expect(issue.json().project.avatarUrl).toBe(
		`/api/avatars/projects/${fixture.projectId}`,
	);
});
