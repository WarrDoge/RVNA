import { afterAll, beforeAll, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { loadSpaceRow, spaceTreeRoots } from "../src/lib/server/wiki/pages.ts";
import { setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("TR");
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

test("a trashed home page falls back to the parentless pages", async () => {
	const fallback = await wiki.page(wiki.admin, space.key, "Fallback root");
	const trashed = await wiki.page(wiki.admin, space.key, "Trashed home");
	await pool.query("update pages set parent_id = null where id = $1", [
		fallback.id,
	]);
	await pool.query("update spaces set home_page_id = $1 where id = $2", [
		trashed.id,
		space.id,
	]);
	await pool.query("update pages set status = 'trashed' where id = $1", [
		trashed.id,
	]);
	const row = await loadSpaceRow(space.key);
	if (!row) throw new Error("space missing");
	const roots = await spaceTreeRoots(row);
	const ids = roots.map((root) => root.id);
	expect(ids).toContain(fallback.id);
	expect(ids).not.toContain(trashed.id);
});
