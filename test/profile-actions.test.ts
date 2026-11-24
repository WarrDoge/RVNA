import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createSession, randomValue, sha256 } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { hashPassword } from "../src/lib/server/passwords.ts";
import { apiTokens, users } from "../src/lib/server/schema.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
let app: TestApp;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function formPost(
	session: string,
	url: string,
	fields: Record<string, string>,
) {
	return app.inject({
		method: "POST",
		url,
		cookies: { sid: session },
		headers: {
			origin: "http://127.0.0.1:3000",
			"content-type": "application/x-www-form-urlencoded",
			accept: "text/html",
		},
		payload: new URLSearchParams(fields).toString(),
	});
}

async function makePasswordUser(label: string, mustChange = false) {
	const username = `t-${run}-${label}`;
	const [row] = await db
		.insert(users)
		.values({
			username,
			displayName: `Password ${label} ${run}`,
			passwordHash: await hashPassword("first long passphrase"),
			mustChangePassword: mustChange,
		})
		.returning({ id: users.id });
	const session = await createSession(row.id, null);
	return { id: row.id, username, session };
}

async function makeTokenUser(label: string, mustChange = true) {
	const user = await makePasswordUser(label, mustChange);
	const token = `rvna_${randomValue()}`;
	const [row] = await db
		.insert(apiTokens)
		.values({
			userId: user.id,
			name: `${label} token`,
			tokenHash: sha256(token),
		})
		.returning({ id: apiTokens.id });
	return { ...user, token, tokenId: row.id };
}

test("an invalid token expiry is rejected instead of creating a token that never expires", async () => {
	const user = await makeUser(run, "expiry");
	const response = await formPost(user.session, "/secure/ViewProfile.jspa", {
		intent: "createToken",
		name: `Bad expiry ${randomUUID()}`,
		expiresInDays: "abc",
	});

	expect(response.statusCode).toBe(400);
	const [created] = await db
		.select({ id: apiTokens.id })
		.from(apiTokens)
		.where(eq(apiTokens.userId, user.id));
	expect(created).toBeUndefined();
});

test("a forced password change allows only the password action", async () => {
	const user = await makePasswordUser("must-token", true);
	const [token] = await db
		.insert(apiTokens)
		.values({
			userId: user.id,
			name: "Existing token",
			tokenHash: randomUUID(),
		})
		.returning({ id: apiTokens.id });

	const actions: Record<string, string>[] = [
		{ intent: "createToken", name: "Escape token" },
		{ intent: "revokeToken", id: token?.id ?? "" },
		{ intent: "saveNotifications", emailNotifications: "on" },
		{ intent: "anythingElse" },
	];
	for (const fields of actions) {
		const response = await formPost(
			user.session,
			"/secure/ViewProfile.jspa?selectedTab=password",
			fields,
		);
		expect(response.statusCode).toBe(403);
		expect(response.body).toContain("Password change required");
	}

	const tokens = await db
		.select({ id: apiTokens.id })
		.from(apiTokens)
		.where(eq(apiTokens.userId, user.id));
	expect(tokens).toEqual([{ id: token?.id }]);
});

test("the forced password change applies to bearer requests too", async () => {
	const user = await makeTokenUser("bearer-gate");
	const headers = { authorization: `Bearer ${user.token}` };

	const blocked = await app.inject({
		method: "GET",
		url: "/api/projects",
		headers,
	});
	expect(blocked.statusCode).toBe(403);
	expect(blocked.json()).toEqual({ error: "Password change required" });

	const page = await app.inject({
		method: "GET",
		url: "/secure/ViewProfile.jspa",
		headers,
	});
	expect(page.statusCode).toBe(403);

	const allowed = await app.inject({
		method: "GET",
		url: "/api/me",
		headers,
	});
	expect(allowed.statusCode).toBe(200);
	expect(allowed.json().mustChangePassword).toBe(true);

	const changed = await app.inject({
		method: "POST",
		url: "/api/me/password",
		headers: { ...headers, "x-requested-with": "rvna" },
		payload: {
			currentPassword: "first long passphrase",
			newPassword: "second long passphrase",
		},
	});
	expect(changed.statusCode).toBe(204);
	expect(changed.headers["set-cookie"]).toBeUndefined();
});

test("the profile token action refuses bearer callers", async () => {
	const user = await makeTokenUser("bearer-tokens", false);
	const headers = {
		authorization: `Bearer ${user.token}`,
		origin: "http://127.0.0.1:3000",
		"content-type": "application/x-www-form-urlencoded",
	};

	const create = await app.inject({
		method: "POST",
		url: "/secure/ViewProfile.jspa",
		headers,
		payload: new URLSearchParams({
			intent: "createToken",
			name: "Bearer-made token",
		}).toString(),
	});
	expect(create.statusCode).toBe(403);
	expect(create.body).toContain("Bearer tokens cannot manage tokens");

	const revoke = await app.inject({
		method: "POST",
		url: "/secure/ViewProfile.jspa",
		headers,
		payload: new URLSearchParams({
			intent: "revokeToken",
			id: user.tokenId,
		}).toString(),
	});
	expect(revoke.statusCode).toBe(403);

	const list = await app.inject({
		method: "GET",
		url: "/secure/ViewProfile.jspa?selectedTab=tokens",
		headers,
	});
	expect(list.statusCode).toBe(403);

	const tokens = await db
		.select({ id: apiTokens.id })
		.from(apiTokens)
		.where(eq(apiTokens.userId, user.id));
	expect(tokens).toEqual([{ id: user.tokenId }]);
});

test("changing the forced password refreshes locals so the profile renders normally", async () => {
	const user = await makePasswordUser("must-change", true);
	const response = await formPost(
		user.session,
		"/secure/ViewProfile.jspa?selectedTab=password",
		{
			intent: "changePassword",
			currentPassword: "first long passphrase",
			newPassword: "second long passphrase",
			confirmPassword: "second long passphrase",
		},
	);

	expect(response.statusCode).toBe(200);
	expect(response.body).toContain("Password changed.");
	expect(response.body).not.toContain(
		"An administrator requires you to choose a new password",
	);

	const cookies = [response.headers["set-cookie"]].flat().map(String);
	const renewed = cookies
		.find((cookie) => cookie.startsWith("sid="))
		?.split(";")[0]
		?.slice(4);
	expect(renewed).toBeTruthy();
	expect(renewed).not.toBe(user.session);
	const old = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: user.session },
	});
	expect(old.statusCode).toBe(401);
	const current = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: renewed as string },
	});
	expect(current.statusCode).toBe(200);
});
