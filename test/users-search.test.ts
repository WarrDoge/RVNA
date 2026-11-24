import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { users } from "../src/lib/server/schema.ts";
import { searchUsers } from "../src/lib/server/users.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const tag = `Tie ${run}`;
const names = Array.from(
	{ length: 25 },
	(_, index) => `t-${run}-tie-${String(25 - index).padStart(2, "0")}`,
);

function actor(id: string, username: string, isAdmin: boolean): CurrentUser {
	return {
		id,
		username,
		displayName: `Search actor ${run}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin,
		mustChangePassword: false,
		hasPassword: false,
	};
}

beforeAll(async () => {
	await runMigrations();
	for (const username of names) {
		await db.insert(users).values({
			username,
			displayName: tag,
			email: `${username}@example.test`,
		});
	}
});

afterAll(async () => {
	await cleanupTestData(run);
	await pool.end();
});

test("equal display names are ordered by username and capped at 20", async () => {
	const me = await makeUser(run, "search-actor");
	const result = await searchUsers(actor(me.id, me.username, true), tag);
	expect(result.map((entry) => entry.username)).toEqual(
		[...names].sort().slice(0, 20),
	);
});

test("a non-admin result has no email field", async () => {
	const me = await makeUser(run, "search-nonadmin");
	const [entry] = await searchUsers(
		actor(me.id, me.username, false),
		me.username,
	);
	expect(entry?.username).toBe(me.username);
	expect(entry).not.toHaveProperty("email");
});

test("an admin result keeps the email field", async () => {
	const me = await makeUser(run, "search-admin");
	const [entry] = await searchUsers(actor(me.id, me.username, true), tag);
	expect(entry?.email).toMatch(new RegExp(`^t-${run}-tie-`));
});
