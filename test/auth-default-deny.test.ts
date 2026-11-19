import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runMigrations } from "../src/lib/server/db.ts";
import {
	livenessRouteIds,
	selfAuthenticatedRoutes,
} from "../src/lib/server/public-routes.ts";
import { buildServer } from "./helpers.ts";
import {
	type AppRoute,
	actionUrls,
	allAppRoutes,
	concreteRoute,
	routeKey,
} from "./route-inventory.ts";
import type { TestApp } from "./server.ts";

/**
 * The only routes that answer without a session. Adding a public route means
 * editing this list on purpose; any other route must answer 401 to an anonymous
 * request, however its URL is spelled.
 */
const PUBLIC = new Set([
	// Liveness, and the GitLab webhook (own secret token).
	"GET /api/health",
	"HEAD /api/health",
	"GET /api/health/live",
	"HEAD /api/health/live",
	"POST /api/integrations/gitlab/webhook",
	// login, callback, logout and the local login (SvelteKit endpoints)
	"GET /auth/login",
	"HEAD /auth/login",
	"GET /auth/callback",
	"HEAD /auth/callback",
	"GET /auth/config",
	"HEAD /auth/config",
	"POST /auth/logout",
	"POST /auth/local",
	// the sign-in page: a Svelte page with a public form action
	"GET /login.jsp",
	"HEAD /login.jsp",
	"POST /login.jsp",
	"GET /login",
	"HEAD /login",
	"POST /login",
	// SPA page routes that only redirect old project keys or fall through to the shell
	"GET /browse/:key",
	"HEAD /browse/:key",
	"GET /projects/:key",
	"HEAD /projects/:key",
	"GET /projects/:key/issues",
	"HEAD /projects/:key/issues",
	"GET /projects/:key/summary",
	"HEAD /projects/:key/summary",
]);

test("the routes that skip the session guard are exactly the public /api routes besides liveness", () => {
	const skipped = selfAuthenticatedRoutes.map(
		(route) => `${route.method} ${route.routeId}`,
	);
	for (const key of skipped) expect(PUBLIC.has(key), key).toBe(true);
	const publicData = [...PUBLIC].filter(
		(key) =>
			/^\w+ \/(api|rest)\//.test(key) &&
			!livenessRouteIds.some((routeId) => key.endsWith(` ${routeId}`)),
	);
	expect(publicData.sort()).toEqual(skipped.sort());
});

// Registered outside the authenticated scope: no CSRF check either.
const OUTSIDE_SCOPE = new Set([
	...selfAuthenticatedRoutes.map((route) => `${route.method} ${route.routeId}`),
]);

const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let app: TestApp;
let routes: AppRoute[];

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	routes = await allAppRoutes();
});

afterAll(async () => {
	await app.close();
});

function encodeFirstLetter(url: string) {
	return url.replace(
		/^\/(.)/,
		(_, char: string) =>
			`/%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
	);
}

function send(
	method: string,
	url: string,
	options: {
		cookie?: boolean;
		csrf?: boolean;
		origin?: string;
		form?: boolean;
	} = {},
) {
	const headers: Record<string, string> = {};
	if (options.csrf) headers["x-requested-with"] = "rvna";
	if (options.origin) headers.origin = options.origin;
	if (options.form) {
		headers["content-type"] = "application/x-www-form-urlencoded";
		headers.accept = "text/html";
	}
	return app.inject({
		method: method as "GET",
		url,
		cookies: options.cookie ? { sid: "not-a-session" } : undefined,
		headers,
		payload: (options.form
			? "name=x"
			: method === "GET" || method === "HEAD"
				? undefined
				: {}) as never,
	});
}

/** 401 for endpoints; a signed-out browser GET on a page goes to one of the sign-in addresses. */
function signInRedirect(response: { headers: Record<string, unknown> }) {
	return /^\/(auth\/login|login\.jsp)\?returnTo=/.test(
		String(response.headers.location),
	);
}

function denied(
	route: AppRoute,
	response: {
		statusCode: number;
		headers: Record<string, unknown>;
	},
) {
	if (response.statusCode === 401) return true;
	if (route.kind !== "page") return false;
	// A route with `trailingSlash = "always"` canonicalises the slash-less address first.
	if (response.statusCode === 308) return true;
	return response.statusCode === 302 && signInRedirect(response);
}

const protectedRoutes = () =>
	routes.filter(
		(route) =>
			!PUBLIC.has(routeKey(route)) &&
			!(route.kind === "page" && route.method === "POST"),
	);

describe("default-deny authentication", () => {
	test("the route list includes endpoints and pages", () => {
		expect(routes.some((route) => route.kind === "endpoint")).toBe(true);
		expect(routes.some((route) => route.kind === "page")).toBe(true);
	});

	test("the route list is not empty and the allow-list has no dead entries", () => {
		expect(protectedRoutes().length).toBeGreaterThan(100);
		const known = new Set(routes.map(routeKey));
		const dead = [...PUBLIC].filter(
			(entry) =>
				!known.has(entry) && !entry.includes("/*") && !entry.includes("/login"),
		);
		expect(dead).toEqual([]);
	});

	test("every other route answers 401 anonymously, spelled plainly or with an encoded first letter", async () => {
		const failures: string[] = [];
		for (const route of protectedRoutes()) {
			const plain = concreteRoute(route.pattern);
			for (const spelling of [plain, encodeFirstLetter(plain)]) {
				const response = await send(route.method, spelling);
				if (!denied(route, response)) {
					failures.push(
						`${routeKey(route)} ${spelling} -> ${response.statusCode}`,
					);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	test("a slash variant is never served as data", async () => {
		const failures: string[] = [];
		for (const route of protectedRoutes()) {
			const plain = concreteRoute(route.pattern);
			for (const spelling of [`${plain}/`, `/${plain}`]) {
				const response = await send(route.method, spelling);
				const shell =
					response.statusCode === 200 &&
					String(response.headers["content-type"]).startsWith("text/html");
				if (
					![401, 403, 404, 308].includes(response.statusCode) &&
					!shell &&
					!(
						route.kind === "page" &&
						response.statusCode === 302 &&
						signInRedirect(response)
					)
				) {
					failures.push(
						`${routeKey(route)} ${spelling} -> ${response.statusCode}`,
					);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	test("a session cookie without X-Requested-With is refused on every mutating endpoint", async () => {
		const failures: string[] = [];
		for (const route of routes) {
			if (
				route.kind !== "endpoint" ||
				!mutating.has(route.method) ||
				OUTSIDE_SCOPE.has(routeKey(route))
			) {
				continue;
			}
			const plain = concreteRoute(route.pattern);
			for (const spelling of [plain, encodeFirstLetter(plain)]) {
				const response = await send(route.method, spelling, { cookie: true });
				if (response.statusCode !== 403) {
					failures.push(
						`${routeKey(route)} ${spelling} -> ${response.statusCode}`,
					);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	test("an anonymous page form action sends the browser to sign in", async () => {
		const failures: string[] = [];
		for (const route of routes.filter(
			(route) =>
				route.kind === "page" &&
				route.method === "POST" &&
				!PUBLIC.has(routeKey(route)),
		)) {
			for (const url of actionUrls(route, concreteRoute(route.pattern))) {
				const response = await send("POST", url, {
					form: true,
					origin: "http://127.0.0.1:3000",
				});
				if (
					![302, 303].includes(response.statusCode) ||
					!signInRedirect(response)
				) {
					failures.push(`${routeKey(route)} ${url} -> ${response.statusCode}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	test("a page form action needs a same-origin Origin", async () => {
		const failures: string[] = [];
		for (const route of routes.filter(
			(route) => route.kind === "page" && route.method === "POST",
		)) {
			for (const url of actionUrls(route, concreteRoute(route.pattern))) {
				const blocked = await send("POST", url, { cookie: true, form: true });
				if (blocked.statusCode !== 403) {
					failures.push(
						`${routeKey(route)} ${url} without Origin -> ${blocked.statusCode}`,
					);
				}
				const allowed = await send("POST", url, {
					cookie: true,
					form: true,
					origin: "http://127.0.0.1:3000",
				});
				if (allowed.statusCode === 403) {
					failures.push(`${routeKey(route)} ${url} with Origin -> 403`);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	test("an unknown session cookie with the header is 401 on every protected route", async () => {
		const failures: string[] = [];
		for (const route of protectedRoutes()) {
			const plain = concreteRoute(route.pattern);
			for (const spelling of [plain, encodeFirstLetter(plain)]) {
				const response = await send(route.method, spelling, {
					cookie: true,
					csrf: true,
				});
				if (!denied(route, response)) {
					failures.push(
						`${routeKey(route)} ${spelling} -> ${response.statusCode}`,
					);
				}
			}
		}
		expect(failures).toEqual([]);
	});

	test("the encoded search URL no longer returns data", async () => {
		const response = await send("GET", "/%61pi/search?jql=project%20%3D%20TER");
		expect(response.statusCode).toBe(401);
		expect(response.json()).not.toHaveProperty("issues");
	});

	test("an unmatched /api path, however spelled, answers 404 JSON", async () => {
		for (const url of ["/api/no-such-route", "/%61pi/no-such-route"]) {
			const response = await send("GET", url);
			expect(response.statusCode).toBe(404);
		}
	});

	test("a public route still answers without a session", async () => {
		const health = await send("GET", "/api/health");
		expect(health.statusCode).toBe(200);
		const config = await send("GET", "/auth/config");
		expect(config.statusCode).toBe(200);
		const logout = await send("POST", "/auth/logout");
		expect(logout.statusCode).toBeLessThan(400);
		const encodedConfig = await send("GET", "/%61uth/config");
		expect(encodedConfig.statusCode).toBe(200);
	});
});
