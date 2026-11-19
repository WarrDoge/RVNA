import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { buildServer } from "./helpers.ts";
import type { TestApp } from "./server.ts";

let app: TestApp;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
});

afterAll(async () => {
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

test("a page allows only the app's own scripts", async () => {
	const response = await app.inject({ method: "GET", url: "/login.jsp" });
	expect(response.statusCode).toBe(200);
	const policy = String(response.headers["content-security-policy"]);
	const scripts = policy.split(";").find((part) => part.includes("script-src"));
	expect(scripts).toContain("'self'");
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
