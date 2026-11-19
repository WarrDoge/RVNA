import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const id = "00000000-0000-4000-8000-000000000000";
const key = "NOPE";
const MiB = 1024 * 1024;

let app: TestApp;
let plain: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	const loggedIn = await login(app, {
		sub: `wiki-edit-limits-${run}`,
		username: `t-${run}-plain`,
		name: "Plain user",
		email: `t-${run}-plain@example.test`,
		groups: [],
	});
	plain = loggedIn.sessionId as string;
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function send(method: "POST" | "PUT" | "DELETE", url: string, payload: object) {
	return app.inject({
		method,
		url,
		cookies: { sid: plain },
		headers: { "x-requested-with": "rvna" },
		payload: payload as never,
	});
}

describe("administrator-only space routes", () => {
	test.each([
		["POST", "/api/wiki/spaces", { key, name: "Nope" }],
		["DELETE", `/api/wiki/spaces/${key}`, {}],
	] as const)("%s %s is administrator only", async (method, url, payload) => {
		expect((await send(method, url, payload)).statusCode).toBe(403);
	});
});

describe("request body limits", () => {
	test("an ordinary wiki editing route keeps Fastify's 1 MiB limit", async () => {
		const response = await send("POST", `/api/wiki/pages/${id}/rename`, {
			title: "x".repeat(MiB + 1),
		});
		expect(response.statusCode).toBe(413);
		expect(response.json()).toMatchObject({
			code: "FST_ERR_CTP_BODY_TOO_LARGE",
		});
	});

	test("the document routes accept a body of 2 MiB and refuse one over 32 MiB", async () => {
		const documents = [
			["PUT", `/api/wiki/pages/${id}/draft`],
			["PUT", `/api/wiki/pages/${id}`],
			["POST", "/api/wiki/pages"],
			["POST", `/api/wiki/spaces/${key}/templates`],
			["PUT", `/api/wiki/templates/${id}`],
		] as const;
		for (const [method, url] of documents) {
			const accepted = await send(method, url, { body: "x".repeat(2 * MiB) });
			expect(accepted.statusCode, `${method} ${url}`).not.toBe(413);
			const refused = await send(method, url, {
				body: "x".repeat(32 * MiB + 1),
			});
			expect(refused.statusCode, `${method} ${url}`).toBe(413);
		}
	});
});
