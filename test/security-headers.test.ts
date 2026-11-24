import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
let app: TestApp;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("every response forbids type sniffing and framing by another site", async () => {
	for (const url of ["/api/health", "/api/me", "/login.jsp", "/no-such-page"]) {
		const { headers } = await app.inject({ method: "GET", url });
		expect(headers["x-content-type-options"], url).toBe("nosniff");
		expect(headers["x-frame-options"], url).toBe("SAMEORIGIN");
		expect(headers["referrer-policy"], url).toBe("same-origin");
	}
});

test("an API answer is not kept by any cache", async () => {
	for (const url of ["/api/me", "/api/health", "/api/no-such-route"]) {
		const { headers } = await app.inject({ method: "GET", url });
		expect(headers["cache-control"], url).toBe("no-store");
	}
});

test("a signed-in HTML page is not kept by any cache", async () => {
	const { sessionId } = await login(app, {
		sub: `sub-${run}-cache`,
		username: `t-${run}-cache`,
		name: "Cache User",
		groups: [],
	});
	const page = await app.inject({
		method: "GET",
		url: "/secure/Dashboard.jspa",
		cookies: { sid: sessionId as string },
	});
	expect(page.statusCode).toBe(200);
	expect(page.headers["content-type"]).toContain("text/html");
	expect(page.headers["cache-control"]).toBe("no-store");

	const anonymous = await app.inject({ method: "GET", url: "/login.jsp" });
	expect(anonymous.headers["cache-control"]).toBeUndefined();
});

test("a page allows only the nonce script and what it loads, not the app's own address", async () => {
	const response = await app.inject({ method: "GET", url: "/login.jsp" });
	expect(response.statusCode).toBe(200);
	const policy = String(response.headers["content-security-policy"]);
	const scripts = policy.split(";").find((part) => part.includes("script-src"));
	expect(scripts).toContain("'strict-dynamic'");
	expect(scripts).not.toContain("'self'");
	expect(scripts).toMatch(/'nonce-[^']+'/);
	expect(scripts).not.toContain("'unsafe-inline'");
	expect(scripts).not.toContain("'unsafe-eval'");
	expect(policy).toContain("object-src 'none'");
	expect(policy).toContain("base-uri 'self'");
	expect(policy).toContain("frame-ancestors 'self'");

	const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
	const inline = [...response.body.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)];
	expect(inline.length).toBeGreaterThan(0);
	for (const [, attributes] of inline) {
		expect(attributes).toContain(`nonce="${nonce}"`);
	}
});
