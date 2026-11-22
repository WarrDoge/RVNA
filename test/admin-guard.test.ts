/// <reference types="vite/client" />

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	adminApiPrefix,
	isAdminPagePath,
} from "../src/lib/server/admin/index.ts";
import { runMigrations } from "../src/lib/server/db.ts";
import * as gitlabRoutes from "../src/lib/server/gitlab/routes.ts";
import { HttpError } from "../src/lib/server/http.ts";
import {
	livenessRouteIds,
	selfAuthenticatedRoutes,
} from "../src/lib/server/public-routes.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import {
	type AppRoute,
	actionUrls,
	allAppRoutes,
	concreteRoute,
	routeKey,
} from "./route-inventory.ts";
import type { TestApp } from "./server.ts";

test("the admin page matcher covers every administration address", () => {
	expect(
		isAdminPagePath("/plugins/servlet/project-config/DEMO/workflows"),
	).toBe(true);
	expect(isAdminPagePath("/plugins/servlet/project-config/DEMO/summary")).toBe(
		false,
	);
	expect(isAdminPagePath("/plugins/servlet/project-config/DEMO/roles")).toBe(
		false,
	);
	expect(isAdminPagePath("/sk-admin")).toBe(true);
	expect(isAdminPagePath("/secure/project")).toBe(true);
});

const run = newRun();
let app: TestApp;
let admin: TestUser;
let member: TestUser;
let routes: AppRoute[];

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	admin = await makeUser(run, "admin", { admin: true });
	member = await makeUser(run, "member");
	routes = await allAppRoutes();
});

afterAll(async () => {
	await app.close();
	await cleanupTestData(run);
});

const adminEndpoints = () =>
	routes.filter(
		(route) =>
			route.kind === "endpoint" &&
			route.pattern.startsWith(`${adminApiPrefix}/`),
	);

const adminPages = () =>
	routes.filter(
		(route) => route.kind === "page" && isAdminPagePath(route.pattern),
	);

const adminRoutes = () => [...adminEndpoints(), ...adminPages()];

const isPageAction = (route: AppRoute) =>
	route.kind === "page" && route.method === "POST";

/** A page action is posted as a browser form is: same-origin `Origin`, urlencoded, HTML accepted. */
function formPost(session: string | null, url: string) {
	return app.inject({
		method: "POST",
		url,
		cookies: session ? { sid: session } : undefined,
		headers: {
			origin: "http://127.0.0.1:3000",
			"content-type": "application/x-www-form-urlencoded",
			accept: "text/html",
		},
		payload: "name=x",
	});
}

/** Every request a route is probed with: one per action for a page action, else one. */
async function probe(session: string | null, route: AppRoute) {
	const url = concreteRoute(route.pattern);
	if (isPageAction(route)) {
		return Promise.all(
			actionUrls(route, url).map(async (action) => ({
				url: action,
				response: await formPost(session, action),
			})),
		);
	}
	return [
		{
			url,
			response: await injectAs(
				app,
				session,
				route.method as "GET",
				url,
				route.method === "GET" || route.method === "HEAD" ? undefined : {},
			),
		},
	];
}

// The only /api routes that answer without a session: liveness, and the GitLab
// webhook, which authenticates with its own secret token.
const publicApiRoutes = new Set([
	...livenessRouteIds.flatMap((routeId) => [
		`GET ${routeId}`,
		`HEAD ${routeId}`,
	]),
	...selfAuthenticatedRoutes.map((route) => `${route.method} ${route.routeId}`),
]);

// The functions that are deliberately not administrator-only, with the reason. `audit` is
// called by project-role and service-desk writes that project administrators may make; the
// other two are public issue and webhook paths. Everything else under admin/ and the
// administrator half of gitlab/routes.ts must refuse a non-administrator itself.
const nonAdminFunctions = new Map<string, string>([
	["audit", "called by non-admin project-role and service-desk writes"],
	["getIssueDevelopment", "issue viewers read the development panel"],
	["acceptGitlabWebhook", "authenticated by the webhook secret, not a user"],
]);

const nonAdminActor = {
	id: "00000000-0000-4000-8000-000000000000",
	username: "non-admin",
	displayName: "Non Admin",
	email: null,
	avatarUrl: null,
	groups: [],
	isAdmin: false,
	mustChangePassword: false,
	hasPassword: true,
};

test("every administrator-only server function refuses a non-administrator itself", async () => {
	const modules = import.meta.glob("../src/lib/server/admin/**/*.ts", {
		eager: true,
	}) as Record<string, Record<string, unknown>>;
	const failures: string[] = [];
	let checked = 0;

	for (const [modulePath, module] of Object.entries(modules)) {
		for (const [name, value] of Object.entries(module)) {
			if (typeof value !== "function") continue;
			if (nonAdminFunctions.has(name)) continue;
			if (value.constructor.name !== "AsyncFunction") continue;
			checked += 1;
			try {
				const args = [
					nonAdminActor,
					...Array(Math.max(0, value.length - 1)).fill(undefined),
				];
				await (value as (...args: unknown[]) => Promise<unknown>)(...args);
				failures.push(`${modulePath} ${name} did not refuse`);
			} catch (error) {
				if (!(error instanceof HttpError) || error.status !== 403) {
					failures.push(
						`${modulePath} ${name} -> ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		}
	}

	for (const [name, value] of Object.entries(gitlabRoutes)) {
		if (typeof value !== "function") continue;
		if (nonAdminFunctions.has(name)) continue;
		if (value.constructor.name !== "AsyncFunction") continue;
		checked += 1;
		try {
			const args = [
				nonAdminActor,
				...Array(Math.max(0, value.length - 1)).fill(undefined),
			];
			await (value as (...args: unknown[]) => Promise<unknown>)(...args);
			failures.push(`gitlab/routes.ts ${name} did not refuse`);
		} catch (error) {
			if (!(error instanceof HttpError) || error.status !== 403) {
				failures.push(
					`gitlab/routes.ts ${name} -> ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	expect(checked).toBeGreaterThan(50);
	expect(failures).toEqual([]);
});

test("admin endpoints exist in the merged app", () => {
	expect(adminEndpoints().length).toBeGreaterThan(0);
});

test("the GitLab administration API sits behind the admin guard", () => {
	const gitlab = adminEndpoints().filter((route) =>
		route.pattern.startsWith(`${adminApiPrefix}/gitlab`),
	);
	expect(gitlab.length).toBeGreaterThan(0);
	expect(
		adminEndpoints().some(
			(route) => routeKey(route) === "GET /api/admin/gitlab",
		),
	).toBe(true);
	expect(
		adminEndpoints().some(
			(route) => routeKey(route) === "PUT /api/admin/gitlab/token",
		),
	).toBe(true);
});

describe("every route of the merged app", () => {
	test("answers 401 without a session unless it is public", async () => {
		const api = routes.filter(
			(route) =>
				route.kind === "endpoint" &&
				route.pattern.startsWith("/api/") &&
				!publicApiRoutes.has(routeKey(route)),
		);
		expect(api.length).toBeGreaterThan(adminEndpoints().length);

		const failures: string[] = [];
		for (const route of api) {
			const response = await injectAs(
				app,
				null,
				route.method as "GET",
				concreteRoute(route.pattern),
				route.method === "GET" || route.method === "HEAD" ? undefined : {},
			);
			if (response.statusCode !== 401) {
				failures.push(`${routeKey(route)} -> ${response.statusCode}`);
			}
		}
		expect(failures).toEqual([]);
	});

	test("the webhook answers without a session but refuses a request without the token", async () => {
		const response = await injectAs(
			app,
			null,
			"POST",
			"/api/integrations/gitlab/webhook",
			{ object_kind: "push" },
		);
		expect(response.statusCode).toBe(401);
		expect(response.json()).toEqual({ error: "Unauthorized" });
	});
});

describe("every admin route", () => {
	test("answers 401 without a session", async () => {
		const failures: string[] = [];
		for (const route of adminEndpoints()) {
			const response = await injectAs(
				app,
				null,
				route.method as "GET",
				concreteRoute(route.pattern),
				route.method === "GET" || route.method === "HEAD" ? undefined : {},
			);
			if (response.statusCode !== 401) {
				failures.push(`${routeKey(route)} -> ${response.statusCode}`);
			}
		}
		expect(failures).toEqual([]);
	});

	test("answers 403 to a signed-in non-admin, JSON for endpoints and a page for pages", async () => {
		const failures: string[] = [];
		for (const route of adminRoutes()) {
			for (const { url, response } of await probe(member.session, route)) {
				const name = `${routeKey(route)} ${url}`;
				if (response.statusCode !== 403) {
					failures.push(`${name} -> ${response.statusCode}`);
					continue;
				}
				if (route.kind === "endpoint") {
					const body = route.method === "HEAD" ? null : response.json();
					if (body && body.error !== "Forbidden") {
						failures.push(`${name} -> ${JSON.stringify(body)}`);
					}
				} else if (
					!String(response.headers["content-type"]).startsWith("text/html")
				) {
					failures.push(`${name} -> ${response.headers["content-type"]}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	test("a page action refuses a non-administrator with fail(403), also for a script request", async () => {
		const failures: string[] = [];
		const actions = adminPages().filter(isPageAction);
		for (const route of actions) {
			for (const url of actionUrls(route, concreteRoute(route.pattern))) {
				const response = await app.inject({
					method: "POST",
					url,
					cookies: { sid: member.session },
					headers: {
						origin: "http://127.0.0.1:3000",
						"content-type": "application/x-www-form-urlencoded",
						accept: "application/json",
						"x-sveltekit-action": "true",
					},
					payload: "name=x",
				});
				const body = response.json() as { type?: string; status?: number };
				if (
					response.statusCode !== 403 ||
					body.type !== "failure" ||
					body.status !== 403 ||
					!String(response.body).includes("Forbidden")
				) {
					failures.push(`${routeKey(route)} ${url} -> ${response.body}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	test("a signed-out page action is sent to sign in", async () => {
		const failures: string[] = [];
		for (const route of adminPages().filter(isPageAction)) {
			for (const { url, response } of await probe(null, route)) {
				if (
					![302, 303].includes(response.statusCode) ||
					!/^\/(auth\/login|login\.jsp)\?returnTo=/.test(
						String(response.headers.location),
					)
				) {
					failures.push(`${routeKey(route)} ${url} -> ${response.statusCode}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	test("lets an admin past the guard", async () => {
		const failures: string[] = [];
		for (const route of adminRoutes()) {
			for (const { url, response } of await probe(admin.session, route)) {
				if (response.statusCode === 401 || response.statusCode === 403) {
					failures.push(`${routeKey(route)} ${url} -> ${response.statusCode}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});
});
