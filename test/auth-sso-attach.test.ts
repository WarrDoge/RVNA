import { eq, ilike } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { hashPassword } from "../src/lib/server/passwords.ts";
import { users } from "../src/lib/server/schema.ts";
import { newRun } from "./admin-helpers.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const name = (label: string) => `t-${run}-${label}`;
const conflict =
	"An account with this username already exists. Ask an administrator to link it.";
let app: TestApp;
let hash: string;
let counter = 0;

beforeAll(async () => {
	await runMigrations();
	hash = await hashPassword("correct horse staple 42");
	app = buildServer();
});

afterAll(async () => {
	await pool.query("delete from audit_log where summary ilike $1", [
		`%${run}%`,
	]);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

async function account(
	label: string,
	options: {
		imported?: boolean;
		password?: boolean;
		email?: string;
		active?: boolean;
		admin?: boolean;
	} = {},
) {
	const [row] = await db
		.insert(users)
		.values({
			username: name(label),
			displayName: `Account ${label}`,
			email: options.email ?? null,
			sourceKey: options.imported ? `src-${run}-${label}` : null,
			passwordHash: options.password ? hash : null,
			active: options.active ?? true,
			adminLocal: options.admin ?? false,
			isAdmin: options.admin ?? false,
		})
		.returning();
	return row;
}

function idp(
	label: string,
	options: { username?: string; email?: string; verified?: boolean } = {},
) {
	counter += 1;
	return {
		sub: `sub-${run}-${label}-${counter}`,
		username: options.username ?? name(label),
		email: options.email,
		emailVerified: options.verified ?? false,
		name: `Identity ${label}`,
		groups: [],
	};
}

async function reload(id: string) {
	const [row] = await db.select().from(users).where(eq(users.id, id));
	return row;
}

async function expectRefused(user: ReturnType<typeof idp>, message = conflict) {
	const { callback, sessionId } = await login(app, user);
	expect(callback.statusCode).toBe(403);
	expect(callback.json()).toEqual({ error: message });
	expect(sessionId).toBeUndefined();
	expect(callback.headers["set-cookie"]).not.toContain("sid=");
}

async function expectLogin(user: ReturnType<typeof idp>) {
	const { callback, sessionId } = await login(app, user);
	expect(callback.statusCode).toBe(303);
	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: sessionId as string },
	});
	return me.json().id as string;
}

test("an IdP user with the username of a local-password account is refused", async () => {
	const local = await account("samename", {
		password: true,
		email: `${name("samename")}@example.test`,
	});
	await expectRefused(
		idp("samename", { email: local.email as string, verified: true }),
	);
	await expectRefused(
		idp("samename-case", {
			username: name("samename").toUpperCase(),
			verified: true,
		}),
	);

	const after = await reload(local.id);
	expect(after.oidcSub).toBeNull();
	expect(after.passwordHash).toBe(hash);
	expect(after.displayName).toBe(local.displayName);
	const duplicates = await db
		.select({ id: users.id })
		.from(users)
		.where(ilike(users.username, name("samename")));
	expect(duplicates).toHaveLength(1);
});

test("the same verified or unverified email does not attach a local-password account", async () => {
	const email = `${name("mail")}@example.test`;
	const local = await account("mail", { password: true, email });

	for (const verified of [true, false]) {
		const id = await expectLogin(
			idp(`mail-id-${verified}`, { email: email.toUpperCase(), verified }),
		);
		expect(id).not.toBe(local.id);
	}
	const after = await reload(local.id);
	expect(after.oidcSub).toBeNull();
	expect(after.passwordHash).toBe(hash);
});

test("an imported account with a password attaches only on a verified matching email", async () => {
	const email = `${name("imp")}@example.test`;
	const imported = await account("imp", {
		imported: true,
		password: true,
		email,
	});

	await expectRefused(
		idp("imp", { email: "other@example.test", verified: true }),
	);
	await expectRefused(idp("imp", { email, verified: false }));
	await expectRefused(idp("imp"));
	expect((await reload(imported.id)).oidcSub).toBeNull();

	const user = idp("imp", { email: email.toUpperCase(), verified: true });
	expect(await expectLogin(user)).toBe(imported.id);
	const after = await reload(imported.id);
	expect(after.oidcSub).toBe(user.sub);
	expect(after.passwordHash).toBe(hash);
});

test("an imported account with a password attaches by verified email when the username differs", async () => {
	const email = `${name("impmail")}@example.test`;
	const imported = await account("impmail", {
		imported: true,
		password: true,
		email,
	});
	const user = idp("impmail-idp", { email, verified: true });
	expect(await expectLogin(user)).toBe(imported.id);
	expect((await reload(imported.id)).passwordHash).toBe(hash);
});

test("an account without a password keeps the old attach rules", async () => {
	const byName = await account("nopw-name", { imported: true });
	expect(await expectLogin(idp("nopw-name"))).toBe(byName.id);

	const email = `${name("nopw-mail")}@example.test`;
	const byMail = await account("nopw-mail", { imported: true, email });
	expect(
		await expectLogin(idp("nopw-mail-idp", { email, verified: true })),
	).toBe(byMail.id);

	const unverified = `${name("nopw-unv")}@example.test`;
	const kept = await account("nopw-unv", { imported: true, email: unverified });
	expect(
		await expectLogin(idp("nopw-unv-idp", { email: unverified })),
	).not.toBe(kept.id);
});

test("the audit log records the first attach of an identity, and only that", async () => {
	const linked = async (id: string) =>
		(
			await pool.query(
				"select count(*)::int as n from audit_log where action = 'account.link' and entity_id = $1",
				[id],
			)
		).rows[0].n;

	const existing = await account("audit-attach", { imported: true });
	const identity = idp("audit-attach");
	expect(await expectLogin(identity)).toBe(existing.id);
	expect(await linked(existing.id)).toBe(1);

	expect(await expectLogin(identity)).toBe(existing.id);
	expect(await linked(existing.id)).toBe(1);

	const created = await expectLogin(idp("audit-new"));
	expect(await linked(created)).toBe(0);
});

test("an inactive account is refused and stays unattached", async () => {
	const email = `${name("off")}@example.test`;
	const off = await account("off", { imported: true, email, active: false });
	await expectRefused(
		idp("off", { email, verified: true }),
		"This account is inactive",
	);

	const offPassword = await account("offpw", {
		imported: true,
		password: true,
		email: `${name("offpw")}@example.test`,
		active: false,
	});
	await expectRefused(
		idp("offpw", { email: offPassword.email as string, verified: true }),
		"This account is inactive",
	);
	await expectRefused(
		idp("offpw", { email: "other@example.test", verified: true }),
	);
	expect((await reload(off.id)).oidcSub).toBeNull();
	expect((await reload(offPassword.id)).oidcSub).toBeNull();
});

test("a local-only administrator cannot be taken over by a lookalike", async () => {
	const email = `${name("rootadmin")}@example.test`;
	const admin = await account("rootadmin", {
		password: true,
		email,
		admin: true,
	});
	await expectRefused(idp("rootadmin", { email, verified: true }));
	const after = await reload(admin.id);
	expect(after.oidcSub).toBeNull();
	expect(after.isAdmin).toBe(true);
	expect(after.passwordHash).toBe(hash);
});

test("an SSO login never changes the password of an attached account", async () => {
	const imported = await account("keeppw", {
		imported: true,
		password: true,
		email: `${name("keeppw")}@example.test`,
	});
	const user = idp("keeppw", {
		email: imported.email as string,
		verified: true,
	});
	await expectLogin(user);
	await expectLogin(user);
	const after = await reload(imported.id);
	expect(after.passwordHash).toBe(hash);
	expect(after.lastLoginAt).toBeInstanceOf(Date);
});

test("an IdP rename onto a taken username keeps the current username", async () => {
	const other = await account("taken", { password: true });
	const user = idp("renamer");
	const id = await expectLogin(user);

	const { callback } = await login(app, {
		...user,
		username: other.username.toUpperCase(),
	});
	expect(callback.statusCode).toBe(303);
	expect((await reload(id)).username).toBe(name("renamer"));
	expect((await reload(other.id)).passwordHash).toBe(hash);
});
