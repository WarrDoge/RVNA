import { afterAll, beforeAll, expect, test } from "vitest";
import { runMigrations } from "../src/lib/server/db.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
let app: TestApp;
let member: TestUser;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	member = await makeUser(run, "member");
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
});

// These administrator routes are not under /api/admin, so the admin guard test does not see them.
test("the project GitLab settings answer 403 to a plain user", async () => {
	for (const method of ["GET", "PATCH"] as const) {
		const response = await injectAs(
			app,
			member.session,
			method,
			"/api/projects/PROJECT/gitlab",
			method === "GET" ? undefined : {},
		);
		expect(response.statusCode, method).toBe(403);
		expect(response.json(), method).toEqual({ error: "Forbidden" });
	}
});

test("the webhook ignores a session cookie and checks only its secret token", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/api/integrations/gitlab/webhook",
		cookies: { sid: member.session },
		headers: { "content-type": "application/json" },
		payload: { object_kind: "push" },
	});
	expect(response.statusCode).toBe(401);
	expect(response.json()).toEqual({ error: "Unauthorized" });
});
