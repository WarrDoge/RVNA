import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
let app: TestApp;
let session: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	const loggedIn = await login(app, {
		sub: `sub-${run}-fallback`,
		username: `t-${run}-fallback`,
		name: "Fallback User",
		groups: [],
	});
	session = loggedIn.sessionId as string;
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("endpoints use SvelteKit method and slash defaults, and the old address redirects", async () => {
	const head = await app.inject({ method: "HEAD", url: "/api/health" });
	expect(head.statusCode).toBe(200);
	expect(head.body).toBe("");

	const options = await app.inject({ method: "OPTIONS", url: "/api/health" });
	expect(options.statusCode).toBe(405);
	expect(options.headers.allow).toBe("GET, HEAD");
	expect(options.body).toBe("OPTIONS method not allowed");

	const trailing = await app.inject({ method: "GET", url: "/api/health/" });
	expect(trailing.statusCode).toBe(308);
	expect(trailing.headers.location).toBe("../health");

	const redirect = await app.inject({
		method: "GET",
		url: "/browse/DEMO",
		cookies: { sid: session },
	});
	expect(redirect.statusCode).toBe(302);
	expect(redirect.headers.location).toBe("/projects/DEMO/summary");
});

test("an administration page answers a non-administrator with 403 HTML", async () => {
	const response = await app.inject({
		method: "GET",
		url: "/secure/admin/user/UserBrowser.jspa",
		cookies: { sid: session },
	});
	expect(response.statusCode).toBe(403);
	expect(response.headers["content-type"]).toContain("text/html");
});

test("an unknown data path answers 404 JSON, an unknown page the not-found page", async () => {
	for (const url of [
		"/api/no-such-route",
		"/rest/no-such-route",
		"/auth/nope",
	]) {
		const response = await app.inject({
			method: "GET",
			url,
			cookies: { sid: session },
		});
		expect(response.statusCode, url).toBe(404);
		expect(response.headers["content-type"], url).toContain("application/json");
		expect(response.json(), url).toEqual({ error: "Not found" });
	}

	const page = await app.inject({
		method: "GET",
		url: "/no-such-page",
		cookies: { sid: session },
	});
	expect(page.statusCode).toBe(404);
	expect(page.headers["content-type"]).toContain("text/html");
	expect(page.body).toContain("This page does not exist");
});

test("the component galleries answer 404 in production and render under test", async () => {
	const gallery = () =>
		app.inject({ method: "GET", url: "/sk-kit", cookies: { sid: session } });

	expect((await gallery()).statusCode).toBe(200);

	const before = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";
	try {
		expect((await gallery()).statusCode).toBe(404);
	} finally {
		process.env.NODE_ENV = before;
	}
});
