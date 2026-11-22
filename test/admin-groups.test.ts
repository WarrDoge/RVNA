import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { effectiveGroups } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { auditLog, groups, userGroups } from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData, swapTransaction } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const name = (label: string) => `t-${run}-${label}`;

let app: TestApp;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let ssoGroupId: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	admin = await makeUser(run, "admin", { admin: true });
	alice = await makeUser(run, "alice");
	bob = await makeUser(run, "bob");
	const [sso] = await db
		.insert(groups)
		.values({ name: name("sso"), local: false })
		.returning();
	ssoGroupId = sso.id;
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

function createGroup(groupName: string) {
	return injectAs(app, admin.session, "POST", "/api/admin/groups", {
		name: groupName,
	});
}

async function auditRows(entityId: string) {
	return db
		.select()
		.from(auditLog)
		.where(eq(auditLog.entityId, entityId))
		.orderBy(auditLog.createdAt);
}

test("creates a local group and refuses a duplicate name", async () => {
	const created = await createGroup(name("team"));
	expect(created.statusCode).toBe(201);
	const group = created.json().group;
	expect(group).toMatchObject({
		name: name("team"),
		local: true,
		members: [],
	});

	const duplicate = await createGroup(name("TEAM"));
	expect(duplicate.statusCode).toBe(409);
	expect(duplicate.json().error).toContain("already exists");

	const empty = await createGroup("   ");
	expect(empty.statusCode).toBe(400);

	const audits = await auditRows(group.id);
	expect(audits.map((entry) => entry.action)).toEqual(["group.create"]);
	expect(audits[0].actorId).toBe(admin.id);
	expect(audits[0].summary).toContain(name("team"));
});

test("concurrent identical group names answer 409", async () => {
	const groupName = name("race");
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
	const fn = `group_delay_${run}`;
	await pool.query(`drop trigger if exists ${fn} on groups`);
	await pool.query(`drop function if exists ${fn}()`);
	await pool.query(
		`create function ${fn}() returns trigger language plpgsql as $$ begin perform pg_sleep(0.4); return new; end $$`,
	);
	await pool.query(
		`create trigger ${fn} before insert on groups for each row execute function ${fn}()`,
	);
	try {
		const first = createGroup(groupName);
		const second = createGroup(groupName);
		await both;
		restore();
		release();
		const responses = await Promise.all([first, second]);
		expect(responses.map((response) => response.statusCode).sort()).toEqual([
			201, 409,
		]);
		const rows = await db
			.select({ id: groups.id })
			.from(groups)
			.where(sql`lower(${groups.name}) = ${groupName.toLowerCase()}`);
		expect(rows).toHaveLength(1);
	} finally {
		restore();
		await pool.query(`drop trigger if exists ${fn} on groups`);
		await pool.query(`drop function if exists ${fn}()`);
		await db
			.delete(groups)
			.where(sql`lower(${groups.name}) = ${groupName.toLowerCase()}`);
	}
});

test("a name that an SSO group already uses is refused", async () => {
	const created = await createGroup(name("sso"));
	expect(created.statusCode).toBe(409);
});

test("lists groups by query and by exact name", async () => {
	await createGroup(name("writers"));

	const all = await injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/groups?query=${encodeURIComponent(`t-${run}`)}`,
	);
	expect(all.statusCode).toBe(200);
	const rows = all.json() as {
		name: string;
		local: boolean;
		memberCount: number;
	}[];
	expect(rows.map((row) => row.name)).toEqual([
		name("sso"),
		name("team"),
		name("writers"),
	]);
	expect(rows.find((row) => row.name === name("sso"))?.local).toBe(false);
	expect(rows.find((row) => row.name === name("team"))?.local).toBe(true);
	expect(rows.find((row) => row.name === name("team"))?.memberCount).toBe(0);

	const exact = await injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/groups?name=${encodeURIComponent(name("team").toUpperCase())}`,
	);
	expect(exact.json()).toHaveLength(1);
	expect(exact.json()[0].name).toBe(name("team"));

	const none = await injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/groups?name=${encodeURIComponent(name("missing"))}`,
	);
	expect(none.json()).toEqual([]);
});

test("adds members idempotently and removes them", async () => {
	const [group] = await db
		.select()
		.from(groups)
		.where(eq(groups.name, name("team")));

	const added = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/groups/${group.id}/members`,
		{ userId: alice.id },
	);
	expect(added.statusCode).toBe(200);
	expect(added.json().group.members).toHaveLength(1);
	expect(added.json().group.members[0]).toMatchObject({
		id: alice.id,
		username: `t-${run}-alice`,
		displayName: `Test alice ${run}`,
		active: true,
	});

	const again = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/groups/${group.id}/members`,
		{ userId: alice.id },
	);
	expect(again.statusCode).toBe(200);
	expect(again.json().group.members).toHaveLength(1);

	const memberships = await db
		.select()
		.from(userGroups)
		.where(eq(userGroups.groupId, group.id));
	expect(memberships).toHaveLength(1);
	expect((await auditRows(group.id)).map((entry) => entry.action)).toEqual([
		"group.create",
		"group.member.add",
	]);

	const detail = await injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/groups/${group.id}`,
	);
	expect(detail.json().members).toHaveLength(1);

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/groups/${group.id}/members/${alice.id}`,
	);
	expect(removed.statusCode).toBe(200);
	expect(removed.json().group.members).toEqual([]);
	expect(
		await db.select().from(userGroups).where(eq(userGroups.groupId, group.id)),
	).toEqual([]);

	const twice = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/groups/${group.id}/members/${alice.id}`,
	);
	expect(twice.statusCode).toBe(404);

	expect((await auditRows(group.id)).map((entry) => entry.action)).toEqual([
		"group.create",
		"group.member.add",
		"group.member.remove",
	]);

	const missingUser = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/groups/${group.id}/members`,
		{ userId: "00000000-0000-4000-8000-000000000000" },
	);
	expect(missingUser.statusCode).toBe(404);
});

test("members of an SSO group follow their source, members added here are editable", async () => {
	await db
		.insert(userGroups)
		.values({ userId: bob.id, groupId: ssoGroupId, source: "oidc" });
	const url = `/api/admin/groups/${ssoGroupId}`;

	const detail = await injectAs(app, admin.session, "GET", url);
	expect(detail.statusCode).toBe(200);
	expect(detail.json().local).toBe(false);
	expect(
		detail
			.json()
			.members.map((member: { id: string; sources: string[] }) => [
				member.id,
				member.sources,
			]),
	).toEqual([[bob.id, ["oidc"]]]);

	const add = await injectAs(app, admin.session, "POST", `${url}/members`, {
		userId: alice.id,
	});
	expect(add.statusCode).toBe(200);
	expect(
		add
			.json()
			.group.members.map((member: { id: string; sources: string[] }) => [
				member.id,
				member.sources,
			])
			.sort(),
	).toEqual(
		[
			[alice.id, ["local"]],
			[bob.id, ["oidc"]],
		].sort(),
	);
	expect(await effectiveGroups(alice.id)).toContain(
		detail.json().name as string,
	);

	const readOnly = await injectAs(
		app,
		admin.session,
		"DELETE",
		`${url}/members/${bob.id}`,
	);
	expect(readOnly.statusCode).toBe(409);
	expect(readOnly.json().error).toContain("follows its source");

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`${url}/members/${alice.id}`,
	);
	expect(removed.statusCode).toBe(200);
	expect(
		removed.json().group.members.map((member: { id: string }) => member.id),
	).toEqual([bob.id]);

	await db
		.insert(userGroups)
		.values({ userId: bob.id, groupId: ssoGroupId, source: "local" });
	const local = await injectAs(
		app,
		admin.session,
		"DELETE",
		`${url}/members/${bob.id}`,
	);
	expect(local.statusCode).toBe(200);
	expect(
		local.json().group.members.map((member: { id: string }) => member.id),
	).toEqual([bob.id]);

	const deleted = await injectAs(app, admin.session, "DELETE", url);
	expect(deleted.statusCode).toBe(409);
	expect(deleted.json().error).toContain("identity provider");
	expect(
		await db.select().from(groups).where(eq(groups.id, ssoGroupId)),
	).toHaveLength(1);
});

test("deleting a local group removes its memberships", async () => {
	const created = await createGroup(name("temporary"));
	const id = created.json().group.id;
	await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/groups/${id}/members`,
		{
			userId: bob.id,
		},
	);

	const deleted = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/groups/${id}`,
	);
	expect(deleted.statusCode).toBe(204);

	expect(await db.select().from(groups).where(eq(groups.id, id))).toEqual([]);
	expect(
		await db.select().from(userGroups).where(eq(userGroups.groupId, id)),
	).toEqual([]);

	expect((await auditRows(id)).map((entry) => entry.action)).toEqual([
		"group.create",
		"group.member.add",
		"group.delete",
	]);
});

test("unknown groups answer 404", async () => {
	const missing = "00000000-0000-4000-8000-000000000000";
	expect(
		(await injectAs(app, admin.session, "GET", `/api/admin/groups/${missing}`))
			.statusCode,
	).toBe(404);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"DELETE",
				`/api/admin/groups/${missing}`,
			)
		).statusCode,
	).toBe(404);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"POST",
				`/api/admin/groups/${missing}/members`,
				{ userId: alice.id },
			)
		).statusCode,
	).toBe(404);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"DELETE",
				`/api/admin/groups/${missing}/members/${alice.id}`,
			)
		).statusCode,
	).toBe(404);
});
