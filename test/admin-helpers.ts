import { randomUUID } from "node:crypto";
import { createSession } from "../src/lib/server/auth.ts";
import { db } from "../src/lib/server/db.ts";
import { users } from "../src/lib/server/schema.ts";
import type { TestApp } from "./server.ts";

/** A new test run id; usernames start with `t-<run>-` so `cleanupTestData(run)` removes them. */
export function newRun() {
	return randomUUID().slice(0, 8);
}

export type TestUser = { id: string; username: string; session: string };

/** Inserts a user and a session directly, no OIDC round trip. */
export async function makeUser(
	run: string,
	label: string,
	options: { admin?: boolean; active?: boolean; email?: string } = {},
): Promise<TestUser> {
	const username = `t-${run}-${label}`;
	const [row] = await db
		.insert(users)
		.values({
			username,
			displayName: `Test ${label} ${run}`,
			email: options.email ?? `${username}@example.test`,
			isAdmin: options.admin ?? false,
			active: options.active ?? true,
		})
		.returning({ id: users.id });
	const session = await createSession(row.id, null);
	return { id: row.id, username, session };
}

export function injectAs(
	app: TestApp,
	session: string | null,
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	url: string,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: session ? { sid: session } : undefined,
		headers: session ? { "x-requested-with": "rvna" } : {},
		payload: payload as never,
	});
}
