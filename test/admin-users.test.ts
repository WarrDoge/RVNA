import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sha256 } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { verifyPassword } from "../src/lib/server/passwords.ts";
import {
	apiTokens,
	auditLog,
	groups,
	sessions,
	userGroups,
	users,
} from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData, swapTransaction } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const password = "quartz-lantern-42";
const newPassword = "harbour-velvet-77";
const name = (label: string) => `t-${run}-${label}`;
const roster = `Roster-${run}`;
const display = (label: string) => `${roster} ${label}`;

let app: TestApp;
let admin: TestUser;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	admin = await makeUser(run, "admin", { admin: true });
});

afterAll(async () => {
	await db
		.delete(auditLog)
		.where(
			sql`${auditLog.actorId} in (select id from users where username ilike ${`t-${run}-%`})`,
		);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function createUser(body: Record<string, unknown>) {
	return injectAs(app, admin.session, "POST", "/api/admin/users", body);
}

function patchUser(id: string, body: Record<string, unknown>) {
	return injectAs(app, admin.session, "PATCH", `/api/admin/users/${id}`, body);
}

function listUsers(query = "") {
	return injectAs(app, admin.session, "GET", `/api/admin/users?${query}`);
}

function expectNoSecret(response: { body: string }) {
	expect(response.body).not.toContain("$argon2");
	expect(response.body).not.toContain("password_hash");
}

async function auditRows(entityId: string) {
	return db
		.select()
		.from(auditLog)
		.where(and(eq(auditLog.entityId, entityId), eq(auditLog.actorId, admin.id)))
		.orderBy(auditLog.createdAt);
}

test("creates a local user with a password and returns no secret", async () => {
	const created = await createUser({
		username: name("alice"),
		displayName: display("alice"),
		email: `${name("alice")}@example.test`,
		password,
	});
	expect(created.statusCode).toBe(201);
	expectNoSecret(created);

	const body = created.json();
	expect(body.generatedPassword).toBeUndefined();
	expect(body.user).toMatchObject({
		username: name("alice"),
		displayName: display("alice"),
		email: `${name("alice")}@example.test`,
		active: true,
		isAdmin: false,
		adminLocal: false,
		hasPassword: true,
		hasSso: false,
		mustChangePassword: false,
		origin: "local",
		groups: [],
	});
	expect(body.user.createdAt).toEqual(expect.any(String));

	const [row] = await db.select().from(users).where(eq(users.id, body.user.id));
	expect(row.passwordHash).toMatch(/^\$argon2id\$/);
	expect(row.passwordChangedAt).toBeInstanceOf(Date);
	expect((await verifyPassword(password, row.passwordHash)).ok).toBe(true);

	const audits = await auditRows(body.user.id);
	expect(audits.map((entry) => entry.action)).toEqual(["user.create"]);
	expect(audits[0].actorName).toBe(`Test admin ${run}`);
	expect(audits[0].summary).toContain(name("alice"));
	expect(JSON.stringify(audits[0].changes)).not.toContain(password);
});

test("rejects duplicates, weak passwords, bad email and spaced usernames", async () => {
	const duplicate = await createUser({
		username: name("ALICE"),
		displayName: display("alice2"),
	});
	expect(duplicate.statusCode).toBe(409);
	expect(duplicate.json().error).toContain("username");

	const duplicateEmail = await createUser({
		username: name("alice3"),
		displayName: display("alice3"),
		email: `${name("alice")}@EXAMPLE.test`,
	});
	expect(duplicateEmail.statusCode).toBe(409);

	const short = await createUser({
		username: name("bob"),
		displayName: display("bob"),
		password: "short",
	});
	expect(short.statusCode).toBe(400);
	expect(short.json().error).toContain("12");

	const common = await createUser({
		username: name("bob2"),
		displayName: display("bob2"),
		password: "password1234",
	});
	expect(common.statusCode).toBe(400);
	expect(common.json().error).toContain("common");

	const badEmail = await createUser({
		username: name("bob3"),
		displayName: display("bob3"),
		email: "not-an-address",
	});
	expect(badEmail.statusCode).toBe(400);

	const spaced = await createUser({
		username: `${name("bo")} b`,
		displayName: display("bob4"),
	});
	expect(spaced.statusCode).toBe(400);
	expect(spaced.json().error).toContain("spaces");

	const empty = await createUser({});
	expect(empty.statusCode).toBe(400);
});

test("a generated password is returned once and must be changed", async () => {
	const created = await createUser({
		username: name("carol"),
		displayName: display("carol"),
		generatePassword: true,
	});
	expect(created.statusCode).toBe(201);
	expectNoSecret(created);

	const body = created.json();
	expect(body.generatedPassword).toEqual(expect.any(String));
	expect(body.user.mustChangePassword).toBe(true);
	expect(body.user.hasPassword).toBe(true);

	const [row] = await db.select().from(users).where(eq(users.id, body.user.id));
	expect(
		(await verifyPassword(body.generatedPassword, row.passwordHash)).ok,
	).toBe(true);

	const detail = await injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/users/${body.user.id}`,
	);
	expect(detail.statusCode).toBe(200);
	expectNoSecret(detail);
	expect(detail.body).not.toContain(body.generatedPassword);
	expect(detail.json().generatedPassword).toBeUndefined();
	expect(detail.json().mustChangePassword).toBe(true);
});

test("lists, searches and filters users", async () => {
	await createUser({
		username: name("dave"),
		displayName: `100% ${display("dave")}`,
		email: `${name("dave")}@example.test`,
		password,
	});
	const erin = await createUser({
		username: name("erin"),
		displayName: display("erin"),
		password,
		isAdmin: true,
	});
	const erinId = erin.json().user.id;
	const [crew] = await db
		.insert(groups)
		.values({ name: name("crew"), local: true })
		.returning();
	await db
		.insert(userGroups)
		.values({ userId: erinId, groupId: crew.id, source: "local" });

	const all = await listUsers(`query=${encodeURIComponent(roster)}`);
	expect(all.statusCode).toBe(200);
	expectNoSecret(all);
	const body = all.json();
	expect(body.total).toBe(4);
	const sortedNames = body.users.map((user: { displayName: string }) =>
		user.displayName.toLowerCase(),
	);
	expect(sortedNames).toEqual([...sortedNames].sort());

	const byName = await listUsers(
		`query=${encodeURIComponent(`100% ${roster}`)}`,
	);
	expect(byName.json().total).toBe(1);
	expect(byName.json().users[0].username).toBe(name("dave"));

	const byExactUsername = await listUsers(
		`username=${encodeURIComponent(name("erin").toUpperCase())}`,
	);
	expect(byExactUsername.json().total).toBe(1);
	expect(byExactUsername.json().users[0].username).toBe(name("erin"));
	expect(byExactUsername.json().users[0].isAdmin).toBe(true);
	expect(byExactUsername.json().users[0].adminLocal).toBe(true);

	const firstPage = await listUsers(
		`query=${encodeURIComponent(roster)}&limit=2`,
	);
	expect(firstPage.json().users).toHaveLength(2);
	expect(firstPage.json().total).toBe(4);

	const secondPage = await listUsers(
		`query=${encodeURIComponent(roster)}&limit=2&offset=2`,
	);
	expect(secondPage.json().users).toHaveLength(2);
	const overlap = secondPage
		.json()
		.users.filter((user: { id: string }) =>
			firstPage
				.json()
				.users.some((first: { id: string }) => first.id === user.id),
		);
	expect(overlap).toEqual([]);

	const inactive = await listUsers(
		`query=${encodeURIComponent(roster)}&active=false`,
	);
	expect(inactive.json().total).toBe(0);

	const byGroup = await listUsers(
		`query=${encodeURIComponent(roster)}&group=${encodeURIComponent(name("CREW"))}`,
	);
	expect(byGroup.statusCode).toBe(200);
	expect(byGroup.json().total).toBe(1);
	expect(byGroup.json().users[0].username).toBe(name("erin"));
	expect(byGroup.json().users[0].groups).toEqual([
		{ id: crew.id, name: name("crew"), local: true },
	]);
});

test("reports the origin of SSO and imported users", async () => {
	const sso = await makeUser(run, "sso");
	await db
		.update(users)
		.set({ oidcSub: `sub-${run}-sso` })
		.where(eq(users.id, sso.id));
	const imported = await makeUser(run, "imported");
	await db
		.update(users)
		.set({ sourceKey: `JIRAUSER-${run}` })
		.where(eq(users.id, imported.id));

	const found = await listUsers(`query=${encodeURIComponent(`t-${run}-sso`)}`);
	expect(found.json().users[0]).toMatchObject({
		origin: "sso",
		hasSso: true,
		hasPassword: false,
	});

	const importedRow = await listUsers(
		`username=${encodeURIComponent(`t-${run}-imported`)}`,
	);
	expect(importedRow.json().users[0]).toMatchObject({
		origin: "imported",
		hasSso: false,
		hasPassword: false,
	});
});

test("updates display name, email and the administrator flag", async () => {
	const created = await createUser({
		username: name("frank"),
		displayName: display("frank"),
		email: `${name("frank")}@example.test`,
		password,
	});
	const id = created.json().user.id;

	const updated = await patchUser(id, {
		displayName: `Frank ${run}`,
		email: `${name("frank")}-new@example.test`,
		isAdmin: true,
	});
	expect(updated.statusCode).toBe(200);
	expect(updated.json().user).toMatchObject({
		displayName: `Frank ${run}`,
		email: `${name("frank")}-new@example.test`,
		isAdmin: true,
		adminLocal: true,
	});

	const duplicateEmail = await patchUser(id, {
		email: `${name("alice")}@example.test`,
	});
	expect(duplicateEmail.statusCode).toBe(409);

	const audits = await auditRows(id);
	expect(audits.map((entry) => entry.action)).toEqual([
		"user.create",
		"user.update",
	]);
	expect(audits[1].changes).toMatchObject({
		from: { adminLocal: false },
		to: { adminLocal: true },
	});

	await patchUser(id, { isAdmin: false });
});

test("an SSO admin group keeps is_admin after admin_local is cleared", async () => {
	const { env } = await import("../src/lib/server/env.ts");
	await db
		.insert(groups)
		.values({ name: env.ADMIN_GROUP, local: false })
		.onConflictDoNothing();
	const [group] = await db
		.select()
		.from(groups)
		.where(eq(groups.name, env.ADMIN_GROUP));

	const member = await makeUser(run, "ssoadmin");
	await db
		.update(users)
		.set({ adminLocal: true, isAdmin: true })
		.where(eq(users.id, member.id));
	await db
		.insert(userGroups)
		.values({ userId: member.id, groupId: group.id })
		.onConflictDoNothing();

	const patched = await patchUser(member.id, { isAdmin: false });
	expect(patched.statusCode).toBe(200);
	expect(patched.json().user.adminLocal).toBe(false);
	expect(patched.json().user.isAdmin).toBe(true);

	await db.delete(userGroups).where(eq(userGroups.userId, member.id));
	await patchUser(member.id, { isAdmin: false });
});

async function withOnlyAdmins<T>(keep: string[], run: () => Promise<T>) {
	const active = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.active, true), eq(users.isAdmin, true)));
	const hidden = active.map((row) => row.id).filter((id) => !keep.includes(id));
	try {
		if (hidden.length > 0) {
			await db
				.update(users)
				.set({ active: false })
				.where(inArray(users.id, hidden));
		}
		return await run();
	} finally {
		if (hidden.length > 0) {
			await db
				.update(users)
				.set({ active: true })
				.where(inArray(users.id, hidden));
		}
	}
}

test("a group administrator can be demoted locally", async () => {
	const { env } = await import("../src/lib/server/env.ts");
	await db
		.insert(groups)
		.values({ name: env.ADMIN_GROUP, local: false })
		.onConflictDoNothing();
	const [group] = await db
		.select()
		.from(groups)
		.where(eq(groups.name, env.ADMIN_GROUP));
	const member = await makeUser(run, "groupadmin");
	await db
		.update(users)
		.set({ adminLocal: true, isAdmin: true })
		.where(eq(users.id, member.id));
	await db
		.insert(userGroups)
		.values({ userId: member.id, groupId: group.id })
		.onConflictDoNothing();

	await withOnlyAdmins([member.id], async () => {
		const patched = await injectAs(
			app,
			member.session,
			"PATCH",
			`/api/admin/users/${member.id}`,
			{ isAdmin: false },
		);
		expect(patched.statusCode, patched.body).toBe(200);
		expect(patched.json().user).toMatchObject({
			adminLocal: false,
			isAdmin: true,
		});
	});
});

test("concurrent demotions keep one administrator", async () => {
	const first = await makeUser(run, "demote-first", { admin: true });
	const second = await makeUser(run, "demote-second", { admin: true });
	await db
		.update(users)
		.set({ adminLocal: true, isAdmin: true })
		.where(inArray(users.id, [first.id, second.id]));

	await withOnlyAdmins([first.id, second.id], async () => {
		const original = db.transaction.bind(db);
		let entered = 0;
		let release = () => {};
		let bothEntered = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const both = new Promise<void>((resolve) => {
			bothEntered = resolve;
		});
		const restore = swapTransaction(async (callback) => {
			entered += 1;
			if (entered === 2) bothEntered();
			await gate;
			return original(callback);
		});
		try {
			const left = injectAs(
				app,
				first.session,
				"PATCH",
				`/api/admin/users/${first.id}`,
				{ isAdmin: false },
			);
			const right = injectAs(
				app,
				first.session,
				"PATCH",
				`/api/admin/users/${second.id}`,
				{ isAdmin: false },
			);
			await both;
			restore();
			release();
			const responses = await Promise.all([left, right]);
			expect(responses.map((response) => response.statusCode).sort()).toEqual([
				200, 409,
			]);
			const [remaining] = await db
				.select({ total: sql<number>`count(*)::int` })
				.from(users)
				.where(and(eq(users.active, true), eq(users.isAdmin, true)));
			expect(remaining.total).toBe(1);
		} finally {
			restore();
		}
	});
});

test("the last active administrator cannot be demoted", async () => {
	const promoted = await patchUser(admin.id, { isAdmin: true });
	expect(promoted.statusCode).toBe(200);
	expect(promoted.json().user.adminLocal).toBe(true);

	const [others] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(users)
		.where(
			and(
				eq(users.active, true),
				eq(users.isAdmin, true),
				ne(users.id, admin.id),
			),
		);

	const demoted = await patchUser(admin.id, { isAdmin: false });
	if ((others?.total ?? 0) > 0) {
		// The shared development database already has another administrator.
		expect(demoted.statusCode).toBe(200);
		await db
			.update(users)
			.set({ adminLocal: true, isAdmin: true })
			.where(eq(users.id, admin.id));
	} else {
		expect(demoted.statusCode).toBe(409);
		expect(demoted.json().error).toContain("last administrator");
	}
});

test("a password reset logs the user out and stores the new hash", async () => {
	const created = await createUser({
		username: name("heidi"),
		displayName: display("heidi"),
		password,
	});
	const id = created.json().user.id;

	await db.insert(sessions).values({
		idHash: `hash-${run}-heidi`,
		userId: id,
		expiresAt: new Date(Date.now() + 60_000),
	});
	const token = `rvna_${run}_heidi`;
	await db.insert(apiTokens).values({
		userId: id,
		name: `heidi token ${run}`,
		tokenHash: sha256(token),
	});
	const bearerBefore = await app.inject({
		method: "GET",
		url: "/api/me",
		headers: { authorization: `Bearer ${token}` },
	});
	expect(bearerBefore.statusCode).toBe(200);

	const reset = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/users/${id}/password`,
		{ password: newPassword, mustChangePassword: true },
	);
	expect(reset.statusCode).toBe(200);
	expectNoSecret(reset);
	expect(reset.json().generatedPassword).toBeUndefined();
	expect(reset.json().user.mustChangePassword).toBe(true);

	const [row] = await db.select().from(users).where(eq(users.id, id));
	expect((await verifyPassword(newPassword, row.passwordHash)).ok).toBe(true);
	expect((await verifyPassword(password, row.passwordHash)).ok).toBe(false);

	const remaining = await db
		.select()
		.from(sessions)
		.where(eq(sessions.userId, id));
	expect(remaining).toEqual([]);
	expect(
		await db.select().from(apiTokens).where(eq(apiTokens.userId, id)),
	).toEqual([]);
	const bearerAfter = await app.inject({
		method: "GET",
		url: "/api/me",
		headers: { authorization: `Bearer ${token}` },
	});
	expect(bearerAfter.statusCode).toBe(401);
	const resetAudit = (await auditRows(id)).find(
		(entry) => entry.action === "user.password.set",
	);
	expect(resetAudit?.changes).toMatchObject({ to: { apiTokensRevoked: 1 } });

	const generated = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/users/${id}/password`,
		{ generate: true },
	);
	expect(generated.statusCode).toBe(200);
	expect(generated.json().generatedPassword).toEqual(expect.any(String));
	expect(generated.json().user.mustChangePassword).toBe(true);

	const neither = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/users/${id}/password`,
		{},
	);
	expect(neither.statusCode).toBe(400);

	const actions = (await auditRows(id)).map((entry) => entry.action);
	expect(actions).toContain("user.password.set");
	for (const entry of await auditRows(id)) {
		expect(entry.summary).not.toContain(newPassword);
	}
});

test("removing a password refuses a user without SSO and logs out an SSO user", async () => {
	const local = await createUser({
		username: name("ivan"),
		displayName: display("ivan"),
		password,
	});
	const refused = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/users/${local.json().user.id}/password`,
	);
	expect(refused.statusCode).toBe(409);
	expect(refused.json().error).toContain("SSO");

	const linked = await createUser({
		username: name("judy"),
		displayName: display("judy"),
		password,
	});
	const linkedId = linked.json().user.id;
	await db
		.update(users)
		.set({ oidcSub: `sub-${run}-judy` })
		.where(eq(users.id, linkedId));
	await db.insert(sessions).values({
		idHash: `hash-${run}-judy`,
		userId: linkedId,
		expiresAt: new Date(Date.now() + 60_000),
	});
	await db.insert(apiTokens).values({
		userId: linkedId,
		name: `judy token ${run}`,
		tokenHash: sha256(`rvna_${run}_judy`),
	});

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/users/${linkedId}/password`,
	);
	expect(removed.statusCode).toBe(200);
	expect(removed.json().user.hasPassword).toBe(false);
	expect(removed.json().user.hasSso).toBe(true);

	const [row] = await db.select().from(users).where(eq(users.id, linkedId));
	expect(row.passwordHash).toBeNull();
	const remaining = await db
		.select()
		.from(sessions)
		.where(eq(sessions.userId, linkedId));
	expect(remaining).toEqual([]);
	expect(
		await db.select().from(apiTokens).where(eq(apiTokens.userId, linkedId)),
	).toEqual([]);
	const removeAudit = (await auditRows(linkedId)).find(
		(entry) => entry.action === "user.password.remove",
	);
	expect(removeAudit?.changes).toMatchObject({ to: { apiTokensRevoked: 1 } });

	const again = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/users/${linkedId}/password`,
	);
	expect(again.statusCode).toBe(409);

	const actions = (await auditRows(linkedId)).map((entry) => entry.action);
	expect(actions).toContain("user.password.remove");
});

test("deactivation removes sessions and API tokens in one transaction", async () => {
	const victim = await makeUser(run, "victim");
	await db.insert(apiTokens).values({
		userId: victim.id,
		name: `token ${run}`,
		tokenHash: `hash-${run}-victim`,
	});

	const deactivated = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/users/${victim.id}/deactivate`,
	);
	expect(deactivated.statusCode).toBe(200);
	expect(deactivated.json().user.active).toBe(false);

	expect(
		await db.select().from(sessions).where(eq(sessions.userId, victim.id)),
	).toEqual([]);
	expect(
		await db.select().from(apiTokens).where(eq(apiTokens.userId, victim.id)),
	).toEqual([]);

	const oldSession = await injectAs(app, victim.session, "GET", "/api/me");
	expect(oldSession.statusCode).toBe(401);

	const audits = await auditRows(victim.id);
	expect(audits.map((entry) => entry.action)).toEqual(["user.deactivate"]);

	const reactivated = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/users/${victim.id}/reactivate`,
	);
	expect(reactivated.statusCode).toBe(200);
	expect(reactivated.json().user.active).toBe(true);
	expect((await auditRows(victim.id)).map((entry) => entry.action)).toEqual([
		"user.deactivate",
		"user.reactivate",
	]);
});

test("an administrator cannot deactivate themselves", async () => {
	const refused = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/users/${admin.id}/deactivate`,
	);
	expect(refused.statusCode).toBe(409);
	expect(refused.json().error).toContain("your own");
});

test("revokes one API token of one user", async () => {
	const owner = await makeUser(run, "tokenowner");
	const other = await makeUser(run, "tokenother");
	const [token] = await db
		.insert(apiTokens)
		.values({
			userId: owner.id,
			name: `revoke me ${run}`,
			tokenHash: `hash-${run}-revoke`,
		})
		.returning();
	const [otherToken] = await db
		.insert(apiTokens)
		.values({
			userId: other.id,
			name: `keep me ${run}`,
			tokenHash: `hash-${run}-keep`,
		})
		.returning();

	const wrongUser = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/users/${owner.id}/tokens/${otherToken.id}`,
	);
	expect(wrongUser.statusCode).toBe(404);

	const revoked = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/users/${owner.id}/tokens/${token.id}`,
	);
	expect(revoked.statusCode).toBe(204);

	expect(
		await db.select().from(apiTokens).where(eq(apiTokens.id, token.id)),
	).toEqual([]);
	expect(
		await db.select().from(apiTokens).where(eq(apiTokens.id, otherToken.id)),
	).toHaveLength(1);

	const audits = await auditRows(owner.id);
	expect(audits.map((entry) => entry.action)).toEqual(["user.token.revoke"]);
});

test("unknown ids answer 404 and never 500", async () => {
	const missing = "00000000-0000-4000-8000-000000000000";
	expect(
		(await injectAs(app, admin.session, "GET", `/api/admin/users/${missing}`))
			.statusCode,
	).toBe(404);
	expect((await patchUser(missing, { displayName: "x" })).statusCode).toBe(404);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"POST",
				`/api/admin/users/${missing}/password`,
				{ generate: true },
			)
		).statusCode,
	).toBe(404);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"DELETE",
				`/api/admin/users/${missing}/password`,
			)
		).statusCode,
	).toBe(404);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"POST",
				`/api/admin/users/${missing}/deactivate`,
			)
		).statusCode,
	).toBe(404);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"POST",
				`/api/admin/users/${missing}/reactivate`,
			)
		).statusCode,
	).toBe(404);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"DELETE",
				`/api/admin/users/${missing}/tokens/${missing}`,
			)
		).statusCode,
	).toBe(404);
});
