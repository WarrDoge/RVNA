import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sha256 } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { sessions, users } from "../src/lib/server/schema.ts";
import {
	adminGroup,
	buildServer,
	cleanupTestData,
	cookieFrom,
	login,
	mockIssuer,
} from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const username = (name: string) => `t-${run}-${name}`;
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

test("OIDC login sets a session and /api/me returns the user with groups", async () => {
	const user = {
		sub: `sub-${run}-alice`,
		username: username("alice"),
		email: `${username("alice")}@example.com`,
		emailVerified: true,
		name: "Alice Example",
		picture: "https://example.com/alice.png",
		groups: [adminGroup(), `t-${run}-team`],
	};

	const { callback, sessionId } = await login(
		app,
		user,
		"/secure/Dashboard.jspa",
	);

	expect(callback.statusCode).toBe(303);
	expect(callback.headers.location).toBe("/secure/Dashboard.jspa");
	expect(sessionId).toBeTruthy();

	const setCookie = String(callback.headers["set-cookie"]);
	expect(setCookie).toContain("sid=");
	expect(setCookie).toContain("HttpOnly");
	expect(setCookie).toContain("SameSite=Lax");
	expect(setCookie).toContain("Path=/");

	const response = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: sessionId as string },
	});

	expect(response.statusCode).toBe(200);
	const me = response.json();
	expect(me).toEqual({
		id: expect.any(String),
		username: user.username,
		displayName: "Alice Example",
		email: user.email,
		avatarUrl: expect.stringMatching(/^\/api\/avatars\/users\//),
		groups: [adminGroup(), `t-${run}-team`].sort(),
		isAdmin: true,
		mustChangePassword: false,
		hasPassword: false,
	});
	expect(me.avatarUrl).not.toBe(user.picture);
});

test("a later login replaces group memberships and the admin flag", async () => {
	const user = {
		sub: `sub-${run}-groups`,
		username: username("groups"),
		email: `${username("groups")}@example.com`,
		emailVerified: true,
		name: "Group User",
		groups: [adminGroup()],
	};

	const first = await login(app, user);
	const firstMe = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: first.sessionId as string },
	});
	expect(firstMe.json().isAdmin).toBe(true);

	const second = await login(app, { ...user, groups: [`t-${run}-other`] });
	const secondMe = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: second.sessionId as string },
	});

	expect(secondMe.json().groups).toEqual([`t-${run}-other`]);
	expect(secondMe.json().isAdmin).toBe(false);
});

test("the callback rejects a state that does not match the transaction", async () => {
	const loginResponse = await app.inject({
		method: "GET",
		url: "/auth/login",
	});
	const transactionId = cookieFrom(loginResponse.headers, "oidc_transaction");

	const response = await app.inject({
		method: "GET",
		url: "/auth/callback?code=whatever&state=not-the-state",
		cookies: { oidc_transaction: transactionId },
	});

	expect(response.statusCode).toBe(400);
	expect(response.json().error).toMatch(/state/i);
	expect(response.headers["set-cookie"]).toBeUndefined();
});

test("the callback rejects a missing transaction cookie", async () => {
	const response = await app.inject({
		method: "GET",
		url: "/auth/callback?code=whatever&state=whatever",
	});

	expect(response.statusCode).toBe(400);
	expect(response.json().error).toMatch(/transaction/i);
	expect(response.headers["set-cookie"]).toBeUndefined();
});

test("unsafe returnTo values redirect to /", async () => {
	const user = {
		sub: `sub-${run}-return-to`,
		username: username("return-to"),
		email: `${username("return-to")}@example.com`,
		emailVerified: true,
		name: "Return To",
		groups: [],
	};

	for (const returnTo of [
		"//evil.example",
		"https://evil.example",
		"/\\evil.example",
		"/\t/evil.example",
		"/ok\\evil.example",
		"/..//evil.example/phish",
		"/%2e%2e//evil.example/x",
		"/a/..//evil.example",
		"/.//evil.example",
	]) {
		const { callback } = await login(app, user, returnTo);
		expect(callback.statusCode).toBe(303);
		expect(callback.headers.location).toBe("/");
	}
});

test("first login attaches the subject to an existing user with the same username", async () => {
	const [existing] = await db
		.insert(users)
		.values({
			username: username("imported"),
			displayName: "Imported User",
		})
		.returning();

	const sub = `sub-${run}-imported`;
	const { callback, sessionId } = await login(app, {
		sub,
		username: username("imported").toUpperCase(),
		email: "different@example.com",
		emailVerified: true,
		name: "Imported User",
		groups: [],
	});

	expect(callback.statusCode).toBe(303);
	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: sessionId as string },
	});
	expect(me.json().id).toBe(existing.id);

	const [row] = await db.select().from(users).where(eq(users.id, existing.id));
	expect(row.oidcSub).toBe(sub);
});

test("a verified email attaches the subject to an imported user", async () => {
	const email = `${username("bymail")}@example.com`;
	const [existing] = await db
		.insert(users)
		.values({
			username: username("bymail-imported"),
			email,
			displayName: "Imported By Mail",
		})
		.returning();

	const { sessionId } = await login(app, {
		sub: `sub-${run}-bymail`,
		username: username("bymail-identity"),
		email: email.toUpperCase(),
		emailVerified: true,
		name: "Imported By Mail",
		groups: [],
	});

	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: sessionId as string },
	});
	expect(me.json().id).toBe(existing.id);
});

test("an unverified email does not attach to an imported user", async () => {
	const email = `${username("unverified")}@example.com`;
	const [existing] = await db
		.insert(users)
		.values({
			username: username("unverified-imported"),
			email,
			displayName: "Imported Unverified",
		})
		.returning();

	const { sessionId } = await login(app, {
		sub: `sub-${run}-unverified`,
		username: username("unverified-identity"),
		email,
		emailVerified: false,
		name: "Unverified Identity",
		groups: [],
	});

	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: sessionId as string },
	});
	expect(me.json().id).not.toBe(existing.id);
});

test("an inactive user is refused a session", async () => {
	await db.insert(users).values({
		oidcSub: `sub-${run}-inactive`,
		username: username("inactive"),
		displayName: "Inactive User",
		active: false,
	});

	const { callback, sessionId } = await login(app, {
		sub: `sub-${run}-inactive`,
		username: username("inactive"),
		name: "Inactive User",
		groups: [],
	});

	expect(callback.statusCode).toBe(403);
	expect(sessionId).toBeUndefined();
});

test("a request without a session cookie is rejected", async () => {
	const response = await app.inject({ method: "GET", url: "/api/me" });
	expect(response.statusCode).toBe(401);
	expect(response.json()).toEqual({ error: "Unauthorized" });
});

test("an expired session is rejected", async () => {
	const [user] = await db
		.insert(users)
		.values({
			username: username("expired"),
			displayName: "Expired Session",
		})
		.returning();

	await db.insert(sessions).values({
		idHash: sha256(`expired-${run}`),
		userId: user.id,
		expiresAt: new Date(Date.now() - 1000),
	});

	const response = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: `expired-${run}` },
	});
	expect(response.statusCode).toBe(401);
});

test("a cookie-authenticated write without X-Requested-With is refused", async () => {
	const { sessionId } = await login(app, {
		sub: `sub-${run}-csrf`,
		username: username("csrf"),
		name: "CSRF User",
		groups: [],
	});

	const blocked = await app.inject({
		method: "POST",
		url: "/api/me/tokens",
		cookies: { sid: sessionId as string },
		payload: { name: "No header" },
	});
	expect(blocked.statusCode).toBe(403);

	const allowed = await app.inject({
		method: "POST",
		url: "/api/me/tokens",
		cookies: { sid: sessionId as string },
		headers: { "x-requested-with": "rvna" },
		payload: { name: "With header" },
	});
	expect(allowed.statusCode).toBe(201);
});

test("logout deletes the session and redirects through the provider", async () => {
	const { sessionId } = await login(app, {
		sub: `sub-${run}-logout`,
		username: username("logout"),
		name: "Logout User",
		groups: [],
	});

	const logout = await app.inject({
		method: "POST",
		url: "/auth/logout",
		cookies: { sid: sessionId as string },
		headers: { "x-requested-with": "rvna" },
	});

	expect(logout.statusCode).toBe(200);
	const redirect = new URL(logout.json().redirect);
	expect(`${redirect.origin}${redirect.pathname}`).toBe(
		`${mockIssuer().issuer}/end_session`,
	);
	expect(redirect.searchParams.get("id_token_hint")).toBeTruthy();
	expect(redirect.searchParams.get("post_logout_redirect_uri")).toBe(
		"http://127.0.0.1:3000/",
	);

	const [row] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.username, username("logout")));
	const audited = await pool.query(
		"select action, entity_type, entity_id, summary from audit_log where actor_id = $1 and action = 'auth.logout'",
		[row?.id],
	);
	expect(audited.rows).toHaveLength(1);
	expect(audited.rows[0]).toMatchObject({
		action: "auth.logout",
		entity_type: "user",
		entity_id: row?.id,
	});
	expect(audited.rows[0].summary).toContain(username("logout"));

	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: sessionId as string },
	});
	expect(me.statusCode).toBe(401);
});
