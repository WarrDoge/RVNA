import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { importConfluenceGroups } from "../src/importer/confluence-groups.ts";
import { db, pool, runMigrations } from "../src/importer/db.ts";
import {
	groups,
	spacePermissions,
	spaces,
	userGroups,
	users,
} from "../src/lib/server/schema.ts";

const run = randomUUID().slice(0, 8);
const groupName = `t-${run}-wiki-readers`;
const unusedGroup = `t-${run}-unused`;
const spaceKey = `CG${run.slice(0, 5).toUpperCase()}`;

let members: string[] = [];
let alice: string;
let bob: string;
let carol: string;

const client = {
	async getJson<T>(path: string, params?: Record<string, unknown>) {
		const start = Number(params?.start ?? 0);
		if (path === "/rest/api/group") {
			return {
				results:
					start === 0 ? [{ name: groupName }, { name: unusedGroup }] : [],
			} as T;
		}
		if (path === `/rest/api/group/${encodeURIComponent(groupName)}/member`) {
			return {
				results: start === 0 ? members.map((username) => ({ username })) : [],
			} as T;
		}
		throw new Error(`unexpected ${path}`);
	},
};

async function sources(userId: string) {
	const rows = await db
		.select({ source: userGroups.source })
		.from(userGroups)
		.where(eq(userGroups.userId, userId));
	return rows.map((row) => row.source).sort();
}

beforeAll(async () => {
	await runMigrations();
	const created = await db
		.insert(users)
		.values(
			["alice", "bob", "carol"].map((name) => ({
				username: `t-${run}-${name}`,
				displayName: name,
			})),
		)
		.returning({ id: users.id });
	[alice, bob, carol] = created.map((row) => row.id);
	const [space] = await db
		.insert(spaces)
		.values({ sourceId: `${run}-space`, key: spaceKey, name: spaceKey })
		.returning();
	await db.insert(spacePermissions).values({
		sourceId: `${run}-read`,
		spaceId: space.id,
		permission: "read",
		groupName,
	});
	const [group] = await db
		.insert(groups)
		.values({ name: groupName })
		.returning();
	await db.insert(userGroups).values([
		{ userId: alice, groupId: group.id, source: "jira" },
		{ userId: carol, groupId: group.id, source: "jira" },
		{ userId: carol, groupId: group.id, source: "local" },
	]);
});

afterAll(async () => {
	await pool.query("delete from spaces where key = $1", [spaceKey]);
	await pool.query("delete from users where username like $1", [`t-${run}-%`]);
	await pool.query("delete from groups where name like $1", [`t-${run}-%`]);
	await pool.end();
});

test("members of a referenced group are added with their own source and nothing else is touched", async () => {
	members = [`t-${run}-alice`, `T-${run}-BOB`, `t-${run}-nobody`];
	const result = await importConfluenceGroups(client);
	expect(result.memberships).toBe(2);
	expect(result.membersWithoutUser).toBe(1);
	expect(await sources(alice)).toEqual(["confluence", "jira"]);
	expect(await sources(bob)).toEqual(["confluence"]);
	expect(await sources(carol)).toEqual(["jira", "local"]);

	const unused = await db
		.select()
		.from(groups)
		.where(eq(groups.name, unusedGroup));
	expect(unused).toHaveLength(0);
});

test("a second run changes nothing and a removed member loses only the confluence row", async () => {
	const again = await importConfluenceGroups(client);
	expect(again.memberships).toBe(0);
	expect(again.removed).toBe(0);

	members = [`t-${run}-alice`];
	const result = await importConfluenceGroups(client);
	expect(result.removed).toBe(1);
	expect(await sources(bob)).toEqual([]);
	expect(await sources(alice)).toEqual(["confluence", "jira"]);
	const [group] = await db
		.select()
		.from(groups)
		.where(eq(groups.name, groupName));
	const kept = await db
		.select()
		.from(userGroups)
		.where(and(eq(userGroups.groupId, group.id), eq(userGroups.userId, carol)));
	expect(kept).toHaveLength(2);
});

test("reads the next page when the server returns fewer rows than requested", async () => {
	const dummyGroups = Array.from({ length: 100 }, (_, index) => ({
		name: `t-${run}-dummy-${index}`,
	}));
	const paged = {
		async getJson<T>(path: string, params?: Record<string, unknown>) {
			const start = Number(params?.start ?? 0);
			if (path === "/rest/api/group") {
				if (start === 0) return { results: dummyGroups } as T;
				if (start === 100) return { results: [{ name: groupName }] } as T;
				return { results: [] } as T;
			}
			if (path === `/rest/api/group/${encodeURIComponent(groupName)}/member`) {
				return {
					results: start === 0 ? [{ username: `t-${run}-bob` }] : [],
				} as T;
			}
			throw new Error(`unexpected ${path}`);
		},
	};

	const result = await importConfluenceGroups(paged);
	expect(result.memberships).toBe(1);
	expect(await sources(bob)).toEqual(["confluence"]);
});

test("tolerates a page without a results array", async () => {
	const empty = {
		async getJson<T>(path: string) {
			if (path === "/rest/api/group") return {} as T;
			throw new Error(`unexpected ${path}`);
		},
	};

	const result = await importConfluenceGroups(empty);
	expect(result.missingInConfluence).toBeGreaterThan(0);
});

test("stops a pagination loop that never ends", async () => {
	let calls = 0;
	const endless = {
		async getJson<T>(path: string) {
			if (path === "/rest/api/group") {
				calls++;
				return {
					results: Array.from({ length: 200 }, (_, index) => ({
						name: `loop-${index}`,
					})),
				} as T;
			}
			throw new Error(`unexpected ${path}`);
		},
	};

	await expect(importConfluenceGroups(endless)).rejects.toThrow(
		/did not finish/,
	);
	expect(calls).toBe(1000);
});
