import { randomUUID } from "node:crypto";
import { stringifySetCookie } from "cookie";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createSession } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { users } from "../src/lib/server/schema.ts";
import {
	buildServer,
	cleanupTestData,
	cookieFrom,
	login,
	mockIssuer,
} from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const returnTo = `/moved-identity-${run}`;
let app: TestApp;

type Route = {
	method: string;
	url: string;
	headers?: Record<string, string>;
};

/** Every moved endpoint, with its public answer where there is no session. */
const publicRoutes: (Route & { status: number })[] = [
	{ method: "GET", url: "/auth/config", status: 200 },
	{
		method: "GET",
		url: `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
		status: 302,
	},
	{ method: "GET", url: "/auth/callback", status: 400 },
	{ method: "POST", url: "/auth/logout", status: 200 },
	{
		method: "POST",
		url: "/auth/local",
		status: 400,
		headers: { "x-requested-with": "rvna" },
	},
	{ method: "GET", url: "/login.jsp", status: -1 },
	{ method: "GET", url: "/login", status: -1 },
];

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
});

afterAll(async () => {
	await pool.query("delete from oidc_transactions where return_to like $1", [
		`${returnTo}%`,
	]);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("every moved public endpoint keeps its documented answer", async () => {
	const failures: string[] = [];
	for (const route of publicRoutes) {
		const response = await app.inject({
			method: route.method as "GET",
			url: route.url,
			payload: route.method === "POST" ? {} : undefined,
			headers: route.headers,
		});
		if (route.status === -1) {
			if (response.statusCode === 302) {
				failures.push(`${route.method} ${route.url} unexpectedly redirected`);
			}
		} else if (response.statusCode !== route.status) {
			failures.push(
				`${route.method} ${route.url} -> ${response.statusCode} ${response.body}`,
			);
		}
	}
	expect(failures).toEqual([]);
});

test("sign-in, callback and sign-out set the same cookie bytes as the Fastify routes did", async () => {
	const username = `t-${run}-cookie`;
	const { loginResponse, callback, transactionId, sessionId } = await login(
		app,
		{ sub: `sub-${username}`, username, name: username, groups: [] },
		returnTo,
	);
	const sid = sessionId as string;
	const logout = await app.inject({
		method: "POST",
		url: "/auth/logout",
		cookies: { sid },
		headers: { "x-requested-with": "rvna" },
	});

	const clear = (name: string, path: string) =>
		stringifySetCookie({
			name,
			value: "",
			path,
			expires: new Date(1),
			maxAge: 0,
		});
	// The session cookie lives SESSION_TTL_DAYS (14 by default); the secure flag is off outside production.
	const session = stringifySetCookie({
		name: "sid",
		value: sid,
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: false,
		maxAge: 14 * 86400,
	});
	expect({
		start: loginResponse.headers["set-cookie"],
		callback: callback.headers["set-cookie"],
		logout: logout.headers["set-cookie"],
	}).toEqual({
		start: [
			stringifySetCookie({
				name: "oidc_transaction",
				value: transactionId,
				path: "/auth",
				httpOnly: true,
				sameSite: "lax",
				secure: false,
				maxAge: 600,
			}),
		],
		callback: [clear("oidc_transaction", "/auth"), session],
		logout: [clear("sid", "/")],
	});
});

test("a user who must change the password may read /api/me with HEAD", async () => {
	const username = `t-${run}-must-change`;
	const [row] = await db
		.insert(users)
		.values({
			username,
			displayName: "Must Change",
			mustChangePassword: true,
		})
		.returning({ id: users.id });
	const sid = await createSession(row.id, null);

	const head = await app.inject({
		method: "HEAD",
		url: "/api/me",
		cookies: { sid },
	});
	expect(head.statusCode).toBe(200);

	const get = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid },
	});
	expect(get.statusCode).toBe(200);

	const blocked = await app.inject({
		method: "GET",
		url: "/api/dashboards",
		cookies: { sid },
	});
	expect(blocked.statusCode).toBe(403);
});

test("the callback exchange sends the APP_URL origin, not the request origin", async () => {
	const username = `t-${run}-callback-origin`;
	mockIssuer().setUser({
		sub: `sub-${username}`,
		username,
		name: username,
		groups: [],
	});

	const start = await app.inject({
		method: "GET",
		url: `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
	});
	expect(start.statusCode).toBe(302);
	const transactionId = cookieFrom(start.headers, "oidc_transaction");
	const authorize = await fetch(start.headers.location as string, {
		redirect: "manual",
	});
	const callbackLocation = authorize.headers.get("location");
	expect(callbackLocation).toBeTruthy();
	const callback = new URL(callbackLocation as string);

	const response = await app.inject({
		method: "GET",
		url: `http://localhost:9999${callback.pathname}${callback.search}`,
		cookies: { oidc_transaction: transactionId },
	});
	expect(response.statusCode).toBe(303);
});

test("a mutating route without a body schema still rejects malformed JSON", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/auth/logout",
		headers: { "content-type": "application/json" },
		payload: "{",
	});
	expect(response.statusCode).toBe(400);
	expect(response.json()).toMatchObject({
		code: "FST_ERR_CTP_INVALID_JSON_BODY",
	});
});
