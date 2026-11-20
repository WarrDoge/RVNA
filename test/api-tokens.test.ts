import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sha256 } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { apiTokens } from "../src/lib/server/schema.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const username = (name: string) => `t-${run}-${name}`;
let app: TestApp;
let sessionId: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	const session = await login(app, {
		sub: `sub-${run}-tokens`,
		username: username("tokens"),
		name: "Token User",
		groups: [],
	});
	sessionId = session.sessionId as string;
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function createToken(payload: { name: string; expiresInDays?: number }) {
	return app.inject({
		method: "POST",
		url: "/api/me/tokens",
		cookies: { sid: sessionId },
		headers: { "x-requested-with": "rvna" },
		payload,
	});
}

test("a token is returned once, stored hashed, and authenticates as a bearer", async () => {
	const created = await createToken({ name: "CI token", expiresInDays: 30 });
	expect(created.statusCode).toBe(201);

	const body = created.json();
	expect(body.token).toMatch(/^rvna_[A-Za-z0-9_-]{43}$/);
	expect(body.name).toBe("CI token");
	expect(body.lastUsedAt).toBeNull();
	expect(body.expiresAt).toEqual(expect.any(String));

	const [row] = await db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.id, body.id));
	expect(row.tokenHash).toBe(sha256(body.token));
	expect(row.tokenHash).not.toBe(body.token);

	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		headers: { authorization: `Bearer ${body.token}` },
	});
	expect(me.statusCode).toBe(200);
	expect(me.json().username).toBe(username("tokens"));

	const list = await app.inject({
		method: "GET",
		url: "/api/me/tokens",
		cookies: { sid: sessionId },
	});
	expect(list.statusCode).toBe(200);
	const listed = list
		.json()
		.find((token: { id: string }) => token.id === body.id);
	expect(listed.lastUsedAt).toEqual(expect.any(String));
	expect(listed.token).toBeUndefined();

	const [used] = await db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.id, body.id));
	expect(used.lastUsedAt).not.toBeNull();
});

test("a bearer token cannot create, list or revoke tokens", async () => {
	const created = await createToken({ name: "Bearer create" });
	const token = created.json().token;

	const create = await app.inject({
		method: "POST",
		url: "/api/me/tokens",
		headers: { authorization: `Bearer ${token}` },
		payload: { name: "Created by bearer" },
	});
	expect(create.statusCode).toBe(403);

	const list = await app.inject({
		method: "GET",
		url: "/api/me/tokens",
		headers: { authorization: `Bearer ${token}` },
	});
	expect(list.statusCode).toBe(403);

	const revoke = await app.inject({
		method: "DELETE",
		url: `/api/me/tokens/${created.json().id}`,
		headers: { authorization: `Bearer ${token}` },
	});
	expect(revoke.statusCode).toBe(403);
});

test("a revoked token no longer authenticates", async () => {
	const created = await createToken({ name: "Revoke me" });
	const { id, token } = created.json();

	const revoked = await app.inject({
		method: "DELETE",
		url: `/api/me/tokens/${id}`,
		cookies: { sid: sessionId },
		headers: { "x-requested-with": "rvna" },
	});
	expect(revoked.statusCode).toBe(204);
	expect(revoked.body).toBe("");

	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		headers: { authorization: `Bearer ${token}` },
	});
	expect(me.statusCode).toBe(401);
});

test("an expired token does not authenticate", async () => {
	const created = await createToken({ name: "Expire me", expiresInDays: 1 });
	const { id, token } = created.json();

	await db
		.update(apiTokens)
		.set({ expiresAt: new Date(Date.now() - 1000) })
		.where(eq(apiTokens.id, id));

	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		headers: { authorization: `Bearer ${token}` },
	});
	expect(me.statusCode).toBe(401);
});

test("one user cannot revoke another user's token", async () => {
	const created = await createToken({ name: "Mine" });
	const { id } = created.json();

	const other = await login(app, {
		sub: `sub-${run}-other`,
		username: username("other"),
		name: "Other User",
		groups: [],
	});

	const response = await app.inject({
		method: "DELETE",
		url: `/api/me/tokens/${id}`,
		cookies: { sid: other.sessionId as string },
		headers: { "x-requested-with": "rvna" },
	});
	expect(response.statusCode).toBe(404);
});

test("creating and revoking a token writes an audit row without the token value", async () => {
	const created = await createToken({
		name: "Audited token",
		expiresInDays: 7,
	});
	const { id, token } = created.json();

	const afterCreate = await pool.query(
		"select action, entity_type, entity_id, summary, changes from audit_log where entity_id = $1 order by created_at",
		[id],
	);
	expect(afterCreate.rows).toHaveLength(1);
	expect(afterCreate.rows[0]).toMatchObject({
		action: "token.create",
		entity_type: "api_token",
		entity_id: id,
	});
	expect(afterCreate.rows[0].summary).toContain("Audited token");
	expect(JSON.stringify(afterCreate.rows)).not.toContain(token);

	const revoke = await app.inject({
		method: "DELETE",
		url: `/api/me/tokens/${id}`,
		cookies: { sid: sessionId },
		headers: { "x-requested-with": "rvna" },
	});
	expect(revoke.statusCode).toBe(204);

	const afterRevoke = await pool.query(
		"select action, entity_type, entity_id, summary from audit_log where entity_id = $1 order by created_at",
		[id],
	);
	expect(afterRevoke.rows).toHaveLength(2);
	expect(afterRevoke.rows[1]).toMatchObject({
		action: "token.revoke",
		entity_type: "api_token",
		entity_id: id,
	});
	expect(afterRevoke.rows[1].summary).toContain("Audited token");
	expect(JSON.stringify(afterRevoke.rows)).not.toContain(token);
});
