import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
let app: TestApp;
let sid: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	const username = `t-${run}-validation`;
	const signedIn = await login(app, {
		sub: `sub-${username}`,
		username,
		name: username,
		groups: [],
	});
	sid = signedIn.sessionId as string;
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function send(
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	url: string,
	payload?: object,
) {
	return app.inject({
		method,
		url,
		cookies: { sid },
		headers: { "x-requested-with": "rvna" },
		payload,
	});
}

test("a route with a 400 schema in its response map answers a validation error through it", async () => {
	for (const response of [
		await send("GET", "/api/search/issues"),
		await send("POST", "/api/filters", {}),
		await send("PATCH", `/api/filters/${randomUUID()}`, { name: 123 }),
	]) {
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({
			error: "Bad Request",
			message: expect.any(String),
		});
	}
});

test("a route without one keeps the full validation body", async () => {
	const response = await send("GET", "/api/search/export");
	expect(response.statusCode).toBe(400);
	expect(response.json()).toMatchObject({
		statusCode: 400,
		code: "FST_ERR_VALIDATION",
		error: "Bad Request",
	});
});

test("the other moved routes that declared a 400 schema answer through it too", async () => {
	const id = randomUUID();
	const rejected = [
		["POST", "/api/issues", {}],
		["POST", "/api/dashboards", {}],
		["POST", "/api/boards", {}],
		["PATCH", `/api/components/${id}`, { name: 123 }],
		["POST", `/api/sprints/${id}/start`, {}],
		["POST", `/api/wiki/pages/${id}/labels`, {}],
		["PATCH", `/api/wiki/comments/${id}`, {}],
		["GET", `/api/boards/${id}/reports/velocity?startAt=abc`, undefined],
		["GET", "/api/global-search?startAt=abc", undefined],
		[
			"GET",
			"/api/servicedesk/projects/PROBE/queues/PROBE?startAt=abc",
			undefined,
		],
		["POST", `/api/servicedesk/portals/${id}/requests`, {}],
	] as const;
	const answers: unknown[] = [];
	for (const [method, url, payload] of rejected) {
		const response = await send(method, url, payload);
		answers.push([method, url, response.statusCode, response.json()]);
	}
	expect(answers).toEqual(
		rejected.map(([method, url]) => [
			method,
			url,
			400,
			{ error: "Bad Request", message: expect.any(String) },
		]),
	);
});

test("project and issue keys are capped at Fastify's 100-character max", async () => {
	const long = "A".repeat(101);
	for (const url of [`/api/projects/${long}`, `/api/issues/${long}`]) {
		const response = await send("GET", url);
		expect([url, response.statusCode]).toEqual([url, 400]);
	}
});

test("comment, worklog and watcher issue keys are capped too", async () => {
	const long = "A".repeat(101);
	const id = randomUUID();
	for (const [method, url, payload] of [
		["PATCH", `/api/issues/${long}/comments/${id}`, { body: "x" }],
		["DELETE", `/api/issues/${long}/worklogs/${id}`, undefined],
		["DELETE", `/api/issues/${long}/watchers/${id}`, undefined],
	] as const) {
		const response = await send(method, url, payload);
		expect([method, response.statusCode]).toEqual([method, 400]);
	}
});
