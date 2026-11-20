import { randomUUID } from "node:crypto";
import { isActionFailure, isHttpError, isRedirect } from "@sveltejs/kit";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessionHandle as handle } from "../src/hooks.server.ts";
import { createSession } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { HttpError, prepareWrite } from "../src/lib/server/http.ts";
import {
	actionFailure,
	loadError,
	passwordPage,
	requirePageUser,
} from "../src/lib/server/http-svelte.ts";
import {
	isExemptWriteRoute,
	mutatingMethods,
	rejectArchivedWriteFor,
	resolvePreviousKeysFor,
	routePattern,
	writeRouteScopes,
} from "../src/lib/server/project-keys.ts";
import { users } from "../src/lib/server/schema.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import { allAppRoutes, routeKey } from "./route-inventory.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const key = fixtureKey(run);
let app: TestApp;
let client: Client;
let projectId: string;
let issueKey: string;

function event(method: string, routeId: string) {
	return {
		request: new Request("http://127.0.0.1:3000", { method }),
		route: { id: routeId },
	} as never;
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	const fixture = await createProjectFixture(client, {
		run,
		key,
		issues: [{ summary: `Moved guard ${run}` }],
	});
	projectId = fixture.projectId;
	issueKey = fixture.issueKeys[0] as string;
});

afterAll(async () => {
	await dropProjectFixture(client, run);
	await cleanupTestData(run);
	await client.end();
	await app.close();
	await pool.end();
});

test("a previous project key is rewritten before the handler sees it", async () => {
	const oldKey = `OLD${run.slice(0, 4).toUpperCase()}`;
	await client.query(
		"insert into project_previous_keys (project_id, key) values ($1, $2)",
		[projectId, oldKey],
	);
	const params = { key: oldKey };
	await resolvePreviousKeysFor(params, {});
	expect(params.key).toBe(key);
});

test("the moved write guard rejects an archived project by SvelteKit route id", async () => {
	await client.query("update projects set archived = true where id = $1", [
		projectId,
	]);
	expect(routePattern("/api/issues/[key]")).toBe("/api/issues/:key");
	expect(routePattern("/(admin)/secure/admin/ViewUser.jspa")).toBe(
		"/secure/admin/ViewUser.jspa",
	);
	expect(
		routePattern(
			"/(app)/servicedesk/customer/portal/[id]/create/[requestTypeId]",
		),
	).toBe("/servicedesk/customer/portal/:id/create/:requestTypeId");
	await expect(
		prepareWrite(event("PATCH", "/api/issues/[key]"), { key: issueKey }, {}),
	).rejects.toMatchObject({
		status: 403,
		message: "This project is archived and read-only",
	});
	expect(
		await rejectArchivedWriteFor({
			method: "GET",
			route: "/api/issues/:key",
			params: { key: issueKey },
		}),
	).toBeNull();
	await client.query("update projects set archived = false where id = $1", [
		projectId,
	]);
});

test("loads and actions recognise the same @sveltejs/kit error classes", () => {
	try {
		loadError(new HttpError(404, "Missing thing"));
	} catch (cause) {
		expect(isHttpError(cause, 404)).toBe(true);
		expect((cause as { body: { message: string } }).body.message).toBe(
			"Missing thing",
		);
	}

	const failure = actionFailure(new HttpError(400, "Bad input"));
	expect(isActionFailure(failure)).toBe(true);
	expect(failure.status).toBe(400);
	expect(failure.data).toEqual({ error: "Bad input" });
});

test("handle redirects a forced password change on a moved page", async () => {
	const [user] = await db
		.insert(users)
		.values({
			username: `t-${run}-mustchange`,
			displayName: "Must change",
			mustChangePassword: true,
		})
		.returning();
	const sid = await createSession(user.id, null);
	const event = {
		request: new Request("http://127.0.0.1:3000/secure/ViewProfile.jspa"),
		url: new URL("http://127.0.0.1:3000/secure/ViewProfile.jspa"),
		cookies: { get: (name: string) => (name === "sid" ? sid : undefined) },
		locals: {},
		route: { id: "/secure/ViewProfile.jspa" },
	} as never;

	try {
		await handle({ event, resolve: async () => new Response("ok") });
	} catch (cause) {
		expect(isRedirect(cause)).toBe(true);
		expect((cause as { location: string }).location).toBe(passwordPage);
	}
});

test("the page helper is the only sign-in redirect and keeps the return address", () => {
	try {
		requirePageUser({
			locals: { user: null },
			url: new URL(`http://127.0.0.1/secure/ViewProfile.jspa?name=dev`),
		});
	} catch (cause) {
		expect(isRedirect(cause)).toBe(true);
		expect((cause as { location: string }).location).toBe(
			"/login.jsp?returnTo=%2Fsecure%2FViewProfile.jspa%3Fname%3Ddev",
		);
	}
});

test("every moved mutating route is covered by the write guards", async () => {
	const moved = (await allAppRoutes()).filter((route) =>
		mutatingMethods.has(route.method),
	);
	for (const route of moved) {
		if (isExemptWriteRoute(route.pattern)) continue;
		expect(
			writeRouteScopes[routeKey(route)],
			`${routeKey(route)} needs a write scope or an exemption`,
		).toBeDefined();
	}
});

test("a mutating route without a write scope is refused", async () => {
	expect(
		await rejectArchivedWriteFor({
			method: "POST",
			route: "/secure/Unregistered.jspa",
		}),
	).toBe("This action is not allowed");
	expect(
		await rejectArchivedWriteFor({
			method: "GET",
			route: "/secure/Unregistered.jspa",
		}),
	).toBeNull();
});

test("the route table accepts a real UUID in a moved write scope", async () => {
	expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
	expect(
		await rejectArchivedWriteFor({
			method: "PATCH",
			route: "/api/components/:id",
			params: { id: randomUUID() },
		}),
	).toBeNull();
});
