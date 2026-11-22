import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool } from "../src/lib/server/db.ts";
import { pageRestrictions } from "../src/lib/server/schema.ts";
import { loadWikiAccess } from "../src/lib/server/wiki/permissions.ts";
import { setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let reader: CurrentUser;
let readerGroup: string;
let rootId: string;
let childId: string;
let grandchildId: string;
let siblingId: string;

async function actorFor(id: string, groups: string[]): Promise<CurrentUser> {
	const { rows } = await pool.query<{
		id: string;
		username: string;
		display_name: string;
		email: string | null;
	}>("select id, username, display_name, email from users where id = $1", [id]);
	const row = rows[0];
	if (!row) throw new Error("test user not found");
	return {
		id: row.id,
		username: row.username,
		displayName: row.display_name,
		email: row.email,
		avatarUrl: null,
		groups,
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};
}

async function restrict(
	pageId: string,
	row: { userId?: string; groupName?: string },
) {
	await db.insert(pageRestrictions).values({
		sourceId: `acc-${randomUUID()}`,
		pageId,
		operation: "read",
		userId: row.userId ?? null,
		groupName: row.groupName ?? null,
	});
}

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("ACC");
	readerGroup = `t-${wiki.run}-acc-readers`;
	const readerClient = await wiki.user("reader", [readerGroup]);
	await wiki.grant(space.id, { userId: readerClient.id }, ["read"]);
	reader = await actorFor(readerClient.id, [readerGroup]);

	const root = await wiki.page(wiki.admin, space.key, "Access root");
	const child = await wiki.page(wiki.admin, space.key, "Access child", {
		parentId: root.id,
	});
	const grandchild = await wiki.page(
		wiki.admin,
		space.key,
		"Access grandchild",
		{
			parentId: child.id,
		},
	);
	const sibling = await wiki.page(wiki.admin, space.key, "Access sibling");
	rootId = root.id;
	childId = child.id;
	grandchildId = grandchild.id;
	siblingId = sibling.id;
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

test("a read restriction hides the page and every descendant", async () => {
	await restrict(rootId, { groupName: `t-${wiki.run}-acc-others` });
	const access = await loadWikiAccess(reader);
	expect(access.hiddenPageIds.has(rootId)).toBe(true);
	expect(access.hiddenPageIds.has(childId)).toBe(true);
	expect(access.hiddenPageIds.has(grandchildId)).toBe(true);
	expect(access.hiddenPageIds.has(siblingId)).toBe(false);
	await db.delete(pageRestrictions).where(eq(pageRestrictions.pageId, rootId));
});

test("a group restriction matches whatever the group name's case", async () => {
	await restrict(rootId, { groupName: readerGroup.toUpperCase() });
	const access = await loadWikiAccess(reader);
	expect(access.hiddenPageIds.has(rootId)).toBe(false);
	await db.delete(pageRestrictions).where(eq(pageRestrictions.pageId, rootId));
});

test("a user id on a restriction takes precedence over a matching group", async () => {
	await restrict(rootId, { userId: wiki.admin.id, groupName: readerGroup });
	const access = await loadWikiAccess(reader);
	expect(access.hiddenPageIds.has(rootId)).toBe(true);
	await db.delete(pageRestrictions).where(eq(pageRestrictions.pageId, rootId));
});

test("a space administrator sees a restricted page and its descendants", async () => {
	await restrict(rootId, { groupName: `t-${wiki.run}-acc-others` });
	await wiki.grant(space.id, { userId: reader.id }, ["administer"]);
	const access = await loadWikiAccess(reader);
	expect(access.hiddenPageIds.has(rootId)).toBe(false);
	expect(access.hiddenPageIds.has(childId)).toBe(false);
	await db.delete(pageRestrictions).where(eq(pageRestrictions.pageId, rootId));
});
