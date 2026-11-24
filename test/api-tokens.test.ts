import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
	type CurrentUser,
	createSession,
	sha256,
} from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { hashPassword } from "../src/lib/server/passwords.ts";
import { apiTokens, users } from "../src/lib/server/schema.ts";
import { auditLog } from "../src/lib/server/schema-admin.ts";
import { createToken as createTokenDirect } from "../src/lib/server/tokens/service.ts";
import {
	buildServer,
	cleanupTestData,
	login,
	swapTransaction,
} from "./helpers.ts";
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

function createToken(
	payload: {
		name: string;
		expiresInDays?: number | null;
		currentPassword?: string;
	},
	sid = sessionId,
) {
	return app.inject({
		method: "POST",
		url: "/api/me/tokens",
		cookies: { sid },
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

test("a bearer request does not rewrite last_used_at on every call", async () => {
	const created = await createToken({ name: "Throttled touch" });
	const { id, token } = created.json();
	const request = () =>
		app.inject({
			method: "GET",
			url: "/api/me",
			headers: { authorization: `Bearer ${token}` },
		});

	expect((await request()).statusCode).toBe(200);
	const first = await db.select().from(apiTokens).where(eq(apiTokens.id, id));
	expect(first[0]?.lastUsedAt).not.toBeNull();

	const recent = new Date(Date.now() - 60_000);
	await db
		.update(apiTokens)
		.set({ lastUsedAt: recent })
		.where(eq(apiTokens.id, id));
	expect((await request()).statusCode).toBe(200);
	const afterRecent = await db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.id, id));
	expect(afterRecent[0]?.lastUsedAt?.getTime()).toBe(recent.getTime());

	const stale = new Date(Date.now() - 10 * 60_000);
	await db
		.update(apiTokens)
		.set({ lastUsedAt: stale })
		.where(eq(apiTokens.id, id));
	expect((await request()).statusCode).toBe(200);
	const afterStale = await db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.id, id));
	expect(afterStale[0]?.lastUsedAt?.getTime()).toBeGreaterThan(stale.getTime());
});

test("a failed last-used write does not reject a valid token", async () => {
	const created = await createToken({ name: "Touch failure" });
	const { id, token } = created.json();
	const fn = `token_touch_fail_${run}`;
	await pool.query(`drop trigger if exists ${fn} on api_tokens`);
	await pool.query(`drop function if exists ${fn}()`);
	await pool.query(
		`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'touch failed'; end $$`,
	);
	await pool.query(
		`create trigger ${fn} before update on api_tokens for each row when (old.id = '${id}') execute function ${fn}()`,
	);
	try {
		const response = await app.inject({
			method: "GET",
			url: "/api/me",
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.statusCode).toBe(200);
	} finally {
		await pool.query(`drop trigger if exists ${fn} on api_tokens`);
		await pool.query(`drop function if exists ${fn}()`);
	}
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

async function tokenActor(): Promise<CurrentUser> {
	const [row] = await db
		.select()
		.from(users)
		.where(eq(users.username, username("tokens")));
	if (!row) throw new Error("user missing");
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		email: row.email,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};
}

function failAuditInsert() {
	const target = db as unknown as { insert: typeof db.insert };
	const original = target.insert;
	target.insert = ((table: Parameters<typeof db.insert>[0]) => {
		if (table === auditLog) throw new Error("audit unavailable");
		return original(table);
	}) as typeof db.insert;
	return () => {
		target.insert = original;
	};
}

test("a token asked to expire in zero days does not become permanent", async () => {
	const actor = await tokenActor();
	const created = await createTokenDirect(
		actor,
		{ name: "Zero days", expiresInDays: 0 },
		"127.0.0.1",
	);
	try {
		expect(created.expiresAt).not.toBeNull();
		expect(Date.parse(created.expiresAt as string)).toBeLessThanOrEqual(
			Date.now(),
		);
	} finally {
		await db.delete(apiTokens).where(eq(apiTokens.id, created.id));
	}
});

test("a failed audit write does not leave an orphaned token", async () => {
	const actor = await tokenActor();
	const undoInsert = failAuditInsert();
	const realTransaction = db.transaction.bind(db);
	const undoTransaction = swapTransaction(((
		callback: Parameters<typeof realTransaction>[0],
	) =>
		realTransaction(async (tx) => {
			const failing = new Proxy(tx, {
				get(target, property) {
					if (property === "insert") {
						return (table: unknown) => {
							if (table === auditLog) throw new Error("audit unavailable");
							return target.insert(table as never);
						};
					}
					const value = Reflect.get(target, property);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			return callback(failing);
		})) as typeof db.transaction);
	try {
		await expect(
			createTokenDirect(actor, { name: "Orphan check" }, "127.0.0.1"),
		).rejects.toThrow("audit unavailable");
	} finally {
		undoTransaction();
		undoInsert();
	}

	const orphaned = await db
		.select()
		.from(apiTokens)
		.where(
			and(eq(apiTokens.userId, actor.id), eq(apiTokens.name, "Orphan check")),
		);
	await db
		.delete(apiTokens)
		.where(
			and(eq(apiTokens.userId, actor.id), eq(apiTokens.name, "Orphan check")),
		);
	expect(orphaned).toEqual([]);
});

const day = 24 * 60 * 60 * 1000;

test("a token without an expiry in the request expires in 90 days, and null means never", async () => {
	const dayAfter = (value: string) => (Date.parse(value) - Date.now()) / day;

	const byDefault = (await createToken({ name: "Default expiry" })).json();
	expect(dayAfter(byDefault.expiresAt)).toBeGreaterThan(89.9);
	expect(dayAfter(byDefault.expiresAt)).toBeLessThanOrEqual(90);

	const named = (
		await createToken({ name: "Thirty days", expiresInDays: 30 })
	).json();
	expect(dayAfter(named.expiresAt)).toBeGreaterThan(29.9);
	expect(dayAfter(named.expiresAt)).toBeLessThanOrEqual(30);

	const never = await createToken({ name: "No expiry", expiresInDays: null });
	expect(never.statusCode).toBe(201);
	expect(never.json().expiresAt).toBeNull();
});

test("an account with a local password must send it to create a token", async () => {
	const name = username("withpw");
	const [row] = await db
		.insert(users)
		.values({
			username: name,
			displayName: "Password Holder",
			passwordHash: await hashPassword("first long passphrase"),
		})
		.returning({ id: users.id });
	const sid = await createSession(row.id, null);
	const tokensOf = () =>
		db.select().from(apiTokens).where(eq(apiTokens.userId, row.id));

	const missing = await createToken({ name: "No password" }, sid);
	expect(missing.statusCode).toBe(400);
	const wrong = await createToken(
		{ name: "Wrong password", currentPassword: "not the password" },
		sid,
	);
	expect(wrong.statusCode).toBe(400);
	expect(wrong.json()).toEqual({ error: "The current password is incorrect" });
	expect(await tokensOf()).toEqual([]);

	const right = await createToken(
		{ name: "Right password", currentPassword: "first long passphrase" },
		sid,
	);
	expect(right.statusCode).toBe(201);
	expect(await tokensOf()).toHaveLength(1);
	expect(JSON.stringify(right.json())).not.toContain("first long passphrase");
});

test("a token keeps working after the user signs out", async () => {
	const other = await login(app, {
		sub: `sub-${run}-signout`,
		username: username("signout"),
		name: "Sign Out",
		groups: [],
	});
	const created = await createToken(
		{ name: "Script token" },
		other.sessionId as string,
	);
	const { token } = created.json();

	const logout = await app.inject({
		method: "POST",
		url: "/auth/logout",
		cookies: { sid: other.sessionId as string },
		headers: { "x-requested-with": "rvna" },
	});
	expect(logout.statusCode).toBe(200);

	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		headers: { authorization: `Bearer ${token}` },
	});
	expect(me.statusCode).toBe(200);
});
