import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createSession } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { health } from "../src/lib/server/health/service.ts";
import { users } from "../src/lib/server/schema.ts";
import { buildServer } from "./helpers.ts";

beforeAll(async () => {
	await runMigrations();
});

afterAll(async () => {
	await pool.end();
});

test("health reports the database is reachable", async () => {
	const app = buildServer();
	const response = await app.inject({ method: "GET", url: "/api/health" });

	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual({ status: "ok" });

	await app.close();
});

test("health answers a must-change user instead of the password gate", async () => {
	const username = `t-health-${randomUUID().slice(0, 8)}`;
	const [row] = await db
		.insert(users)
		.values({
			username,
			displayName: "Health User",
			mustChangePassword: true,
		})
		.returning({ id: users.id });
	const sid = await createSession(row.id, null);
	const app = buildServer();
	const response = await app.inject({
		method: "GET",
		url: "/api/health",
		cookies: { sid },
	});
	expect([response.statusCode, response.json()]).toEqual([
		200,
		{ status: "ok" },
	]);
	await app.close();
});

test("liveness answers without a database query", async () => {
	const app = buildServer();
	const spy = vi
		.spyOn(db.$client, "query")
		.mockRejectedValue(new Error("down"));
	try {
		const response = await app.inject({
			method: "GET",
			url: "/api/health/live",
			cookies: { sid: "not-a-real-session" },
		});
		expect([response.statusCode, response.json()]).toEqual([
			200,
			{ status: "ok" },
		]);
		expect(spy).not.toHaveBeenCalled();
	} finally {
		spy.mockRestore();
		await app.close();
	}
});

test("health answers 503 before a session lookup when the database is down", async () => {
	const app = buildServer();
	const spy = vi
		.spyOn(db.$client, "query")
		.mockRejectedValue(new Error("down"));
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const response = await app.inject({
			method: "GET",
			url: "/api/health",
			cookies: { sid: "not-a-real-session" },
		});
		expect([response.statusCode, response.json()]).toEqual([
			503,
			{ status: "error" },
		]);
	} finally {
		log.mockRestore();
		spy.mockRestore();
		await app.close();
	}
});

test("the probe gives up when the database does not answer", async () => {
	const query = vi
		.spyOn(db.$client, "query")
		.mockImplementation(() => new Promise(() => {}));
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	vi.useFakeTimers();
	try {
		const pending = health();
		await vi.advanceTimersByTimeAsync(5_000);
		await expect(pending).resolves.toEqual({ status: "error" });
		expect(log).toHaveBeenCalledWith(
			"Health check failed",
			expect.objectContaining({
				message: "The database health check timed out",
			}),
		);
	} finally {
		vi.useRealTimers();
		log.mockRestore();
		query.mockRestore();
	}
});

test("a failed probe logs the cause", async () => {
	const query = vi
		.spyOn(db.$client, "query")
		.mockRejectedValueOnce(new Error("database down"));
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		await expect(health()).resolves.toEqual({ status: "error" });
		expect(log).toHaveBeenCalledWith(
			"Health check failed",
			expect.objectContaining({ message: "database down" }),
		);
	} finally {
		log.mockRestore();
		query.mockRestore();
	}
});
