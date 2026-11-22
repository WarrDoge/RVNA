import { afterAll, beforeAll, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { pagesWithLabels } from "../src/lib/server/wiki/data.ts";
import type { WikiAccess } from "../src/lib/server/wiki/permissions.ts";
import { type Client, setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let author: Client;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("LB");
	author = await wiki.user("author");
	await wiki.grant(space.id, { userId: author.id }, ["read", "create"]);
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

function access(): WikiAccess {
	return {
		userId: author.id,
		isAdmin: true,
		readableSpaceIds: new Set([space.id]),
		hiddenPageIds: new Set(),
	};
}

test("duplicate and differently-cased labels still match pages", async () => {
	const page = await wiki.page(author, space.key, "Label page", {
		labels: ["alpha", "beta"],
	});
	const duplicate = await pagesWithLabels(
		access(),
		["alpha", "alpha"],
		[space.id],
		{ matchAll: true },
	);
	expect(duplicate.map((link) => link.id)).toEqual([page.id]);
	const mixed = await pagesWithLabels(access(), ["Alpha"], [space.id]);
	expect(mixed.map((link) => link.id)).toEqual([page.id]);
});
