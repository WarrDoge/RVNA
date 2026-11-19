import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runMigrations } from "../src/lib/server/db.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";

const run = newRun();
let app: ReturnType<typeof buildServer>;
let admin: TestUser;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	admin = await makeUser(run, "admin", { admin: true });
});

afterAll(async () => {
	await app.close();
	await cleanupTestData(run);
});

// These routes declared `400: errorSchema` in Fastify, so a validation error was
// serialised through it; the schema now also carries the detail in `message`.
test("a rejected input answers the 400 schema with the detail on the routes that declared it", async () => {
	const id = randomUUID();
	const rejected = [
		["POST", "/api/admin/issue-types", {}],
		["PATCH", `/api/admin/issue-types/${id}`, { name: 123 }],
		["DELETE", "/api/admin/issue-types/not-a-uuid", undefined],
		["POST", "/api/admin/custom-fields", {}],
		["PATCH", `/api/admin/custom-fields/${id}`, { name: 123 }],
		["PUT", `/api/admin/custom-fields/${id}/contexts`, { contexts: "x" }],
		["POST", `/api/admin/custom-fields/${id}/options`, { value: 123 }],
		["PUT", "/api/admin/gitlab", { baseUrl: 123 }],
		[
			"POST",
			`/api/admin/permission-schemes/${id}/grants`,
			{ permissionKey: "NOPE" },
		],
		[
			"PUT",
			"/api/admin/workflow-assignments/PROBE",
			{ defaultWorkflowId: 123 },
		],
		["PUT", `/api/admin/workflows/${id}/draft`, {}],
		["POST", "/api/admin/projects", {}],
		["PATCH", "/api/admin/projects/PROBE", { name: 123 }],
		["PATCH", `/api/admin/users/${id}`, { displayName: 123 }],
		["POST", `/api/admin/users/${id}/password`, { password: 123 }],
		["POST", "/api/admin/users", {}],
		["POST", "/api/admin/groups", {}],
		["PUT", "/api/admin/priorities/order", {}],
		["PUT", "/api/admin/settings", { applicationTitle: 1 }],
		["GET", "/api/admin/audit?limit=abc", undefined],
	] as const;
	const answers: unknown[] = [];
	for (const [method, url, payload] of rejected) {
		const response = await injectAs(app, admin.session, method, url, payload);
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
