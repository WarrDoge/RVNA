import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();

type MovedRoute = {
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string;
	auth: "user" | "public" | "jira" | "admin";
};

const id = randomUUID();

/** Every endpoint of this area. */
const movedRoutes: MovedRoute[] = [
	{ method: "GET", path: "/api/projects", auth: "user" },
	{ method: "GET", path: "/api/projects/PROBE", auth: "user" },
	{ method: "GET", path: "/api/projects/PROBE/issues", auth: "user" },
	{ method: "PATCH", path: "/api/projects/PROBE", auth: "user" },
	{ method: "POST", path: "/api/projects/PROBE/components", auth: "user" },
	{ method: "PATCH", path: `/api/components/${id}`, auth: "user" },
	{ method: "DELETE", path: `/api/components/${id}`, auth: "user" },
	{ method: "POST", path: "/api/projects/PROBE/versions", auth: "user" },
	{ method: "PATCH", path: `/api/versions/${id}`, auth: "user" },
	{ method: "DELETE", path: `/api/versions/${id}`, auth: "user" },
	{ method: "GET", path: "/api/projects/PROBE/roles", auth: "user" },
	{
		method: "POST",
		path: "/api/projects/PROBE/roles/viewer/actors",
		auth: "user",
	},
	{
		method: "DELETE",
		path: `/api/projects/PROBE/roles/viewer/actors/${id}`,
		auth: "user",
	},
	{
		method: "GET",
		path: `/api/admin/users/${id}/project-roles`,
		auth: "admin",
	},
	{ method: "GET", path: "/api/projects/PROBE/custom-fields", auth: "user" },
	{ method: "POST", path: "/api/issues/PROBE-1/attachments", auth: "user" },
	{ method: "GET", path: `/api/attachments/${id}`, auth: "user" },
	{ method: "DELETE", path: `/api/attachments/${id}`, auth: "user" },
	{ method: "GET", path: "/browse/PROBE", auth: "public" },
	{ method: "GET", path: "/browse/PROBE-1", auth: "public" },
	{ method: "GET", path: "/projects/PROBE", auth: "public" },
	{ method: "GET", path: "/projects/PROBE/issues", auth: "public" },
	{ method: "GET", path: "/projects/PROBE/summary", auth: "public" },
	{ method: "GET", path: "/secure/Logout!default.jspa", auth: "public" },
	{ method: "GET", path: "/secure/QuickSearch.jspa", auth: "public" },
	{
		method: "GET",
		path: "/projects/PROBE/issues/PROBE-1",
		auth: "public",
	},
	{ method: "GET", path: "/secure/attachment/10001/file.txt", auth: "public" },
	{ method: "GET", path: "/secure/attachmentzip/10001.zip", auth: "public" },
	{ method: "GET", path: "/issues/", auth: "public" },
	{ method: "GET", path: "/secure/Dashboard.jspa", auth: "public" },
	{ method: "GET", path: "/rest/api/2/issue/PROBE-1", auth: "jira" },
	{ method: "GET", path: "/rest/api/2/search", auth: "jira" },
];

const pagePaths = new Set([
	"/browse/PROBE",
	"/browse/PROBE-1",
	"/projects/PROBE",
	"/projects/PROBE/issues",
	"/projects/PROBE/summary",
	"/issues/",
	"/secure/Dashboard.jspa",
]);

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
	await pool.end();
});

test("every moved endpoint answers anonymously with its documented guard", async () => {
	for (const route of movedRoutes) {
		const response = await injectAs(app, null, route.method, route.path);
		if (route.auth === "user") {
			expect(
				{ route: `${route.method} ${route.path}`, status: response.statusCode },
				"a moved API endpoint needs a session",
			).toEqual({
				route: `${route.method} ${route.path}`,
				status: 401,
			});
			expect(response.json()).toEqual({ error: "Unauthorized" });
			continue;
		}
		if (route.auth === "jira") {
			expect(
				{ route: `${route.method} ${route.path}`, status: response.statusCode },
				"the Jira compatibility endpoints answer Jira's 401",
			).toEqual({
				route: `${route.method} ${route.path}`,
				status: 401,
			});
			expect(response.json().errorMessages).toHaveLength(1);
			continue;
		}
		if (route.auth === "admin") {
			expect(response.statusCode).toBe(401);
			continue;
		}

		if (pagePaths.has(route.path)) {
			// A Svelte page: the one sign-in redirect of `pageLoad`.
			expect(response.statusCode, route.path).toBe(302);
			expect(String(response.headers.location), route.path).toMatch(
				/^\/login\.jsp\?returnTo=/,
			);
			continue;
		}
		if (
			route.path.startsWith("/secure/") ||
			route.path === "/projects/PROBE/issues/PROBE-1"
		) {
			expect(response.statusCode).toBe(302);
			expect(String(response.headers.location)).toMatch(
				/^\/auth\/login\?returnTo=/,
			);
			continue;
		}
		expect([200, 404]).toContain(response.statusCode);
		if (response.statusCode === 200) {
			expect(String(response.headers["content-type"])).toContain("text/html");
		}
	}
});

test("the administrator-only endpoint refuses a plain user", async () => {
	const response = await injectAs(
		app,
		member.session,
		"GET",
		`/api/admin/users/${id}/project-roles`,
	);
	expect(response.statusCode).toBe(403);
	expect(response.json()).toEqual({ error: "Forbidden" });
});

test("the navigator answers /issues and /issues/ alike: an anonymous visitor signs in first", async () => {
	for (const path of ["/issues?filter=10200", "/issues/?filter=10200"]) {
		const response = await injectAs(app, null, "GET", path);
		expect(response.statusCode, path).toBe(302);
		expect(String(response.headers.location), path).toMatch(
			/^\/login\.jsp\?returnTo=/,
		);
	}
});
