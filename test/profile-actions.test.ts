import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createSession } from "../src/lib/server/auth.ts";
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
});
