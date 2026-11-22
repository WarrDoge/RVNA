import { expect } from "vitest";
import { db, pool } from "../src/lib/server/db.ts";
import type { MockIssuer, MockUser } from "./oidc-mock.ts";
import type { TestApp } from "./server.ts";

type Transaction = typeof db.transaction;

/** Replaces `db.transaction` on the proxy target; returns the undo. */
export function swapTransaction(next: Transaction) {
	const target = db as unknown as { transaction: Transaction };
	const previous = target.transaction;
	target.transaction = next;
	return () => {
		target.transaction = previous;
	};
}

export function mockIssuer(): MockIssuer {
	const issuer = (globalThis as { oidcMock?: MockIssuer }).oidcMock;
	if (!issuer) throw new Error("Mock issuer is not running");
	return issuer;
}

export function adminGroup(): string {
	const group = (globalThis as { adminGroup?: string }).adminGroup;
	if (!group) throw new Error("Admin group is not configured");
	return group;
}

export function cookieFrom(headers: Record<string, unknown>, name: string) {
	const header = headers["set-cookie"];
	const values = Array.isArray(header)
		? header.map(String)
		: typeof header === "string"
			? [header]
			: [];
	for (const value of values) {
		const [pair] = value.split(";");
		const [key, ...rest] = pair.split("=");
		if (key === name) return rest.join("=");
	}
	throw new Error(`Cookie ${name} was not set`);
}

export async function login(app: TestApp, user: MockUser, returnTo = "/") {
	mockIssuer().setUser(user);
	const loginResponse = await app.inject({
		method: "GET",
		url: `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
	});
	expect(loginResponse.statusCode).toBe(302);

	const location = loginResponse.headers.location;
	if (!location) throw new Error("Login did not redirect");
	const transactionId = cookieFrom(loginResponse.headers, "oidc_transaction");

	const authorizeResponse = await fetch(location, { redirect: "manual" });
	const callbackLocation = authorizeResponse.headers.get("location");
	if (!callbackLocation) throw new Error("Authorize did not redirect");

	const callbackUrl = new URL(callbackLocation);
	const callback = await app.inject({
		method: "GET",
		url: `${callbackUrl.pathname}${callbackUrl.search}`,
		cookies: { oidc_transaction: transactionId },
	});
	const sessionId =
		callback.statusCode === 303
			? cookieFrom(callback.headers, "sid")
			: undefined;

	return { loginResponse, callback, transactionId, sessionId };
}

export async function cleanupTestData(run: string) {
	await pool.query("delete from users where username ilike $1", [`t-${run}-%`]);
	await pool.query("delete from groups where name = $1 or name like $2", [
		adminGroup(),
		`t-${run}-%`,
	]);
}

export async function grantDefaultProjectRole(
	projectId: string,
	usernames: string[],
	role: "admin" | "member" | "viewer" = "member",
) {
	for (const username of usernames) {
		await pool.query(
			`insert into project_role_actors
			 (source_id, project_id, role_id, role_name, actor_type, actor_parameter, actor_display_name, raw)
			 values ($1, $2, $3, $3, 'user', $4, $4, '{}'::jsonb)
			 on conflict (source_id) do nothing`,
			[`test:${projectId}:${role}:${username}`, projectId, role, username],
		);
	}
}

export { buildServer } from "./server.ts";
