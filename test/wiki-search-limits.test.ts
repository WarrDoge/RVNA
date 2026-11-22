import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	searchWikiPages,
	suggestWikiPages,
} from "../src/lib/server/wiki/search.ts";
import { setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("SRC");
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

test("a large hidden-page set does not overflow the query parameters", async () => {
	const title = `Searchable ${wiki.run}`;
	await wiki.page(wiki.admin, space.key, title);
	const hiddenPageIds = new Set(
		Array.from({ length: 70_000 }, () => randomUUID()),
	);
	const result = await searchWikiPages(
		{
			userId: "search-test",
			isAdmin: false,
			readableSpaceIds: new Set([space.id]),
			hiddenPageIds,
		},
		{ query: "" },
	);
	expect(result.hits.map((hit) => hit.title)).toContain(title);
});

test("a search treats percent and underscore as literal characters", async () => {
	const literal = `Literal 100%_done ${wiki.run}`;
	const wildcardish = `Literal 100ABdone ${wiki.run}`;
	await wiki.page(wiki.admin, space.key, literal);
	await wiki.page(wiki.admin, space.key, wildcardish);
	const result = await searchWikiPages(
		{
			userId: "search-test",
			isAdmin: false,
			readableSpaceIds: new Set([space.id]),
			hiddenPageIds: new Set(),
		},
		{ query: "100%_" },
	);
	expect(result.hits.map((hit) => hit.title)).toContain(literal);
	expect(result.hits.map((hit) => hit.title)).not.toContain(wildcardish);
});

test("a title close to the query still matches", async () => {
	const title = `Deployment checklist ${wiki.run}`;
	await wiki.page(wiki.admin, space.key, title);
	const result = await searchWikiPages(
		{
			userId: "search-test",
			isAdmin: false,
			readableSpaceIds: new Set([space.id]),
			hiddenPageIds: new Set(),
		},
		{ query: `Deploymnet checklist ${wiki.run}` },
	);
	expect(result.hits.map((hit) => hit.title)).toContain(title);
});

test("suggestions keep the lower 0.25 title threshold", async () => {
	const title = "Deployment checklist";
	await wiki.page(wiki.admin, space.key, title);
	const { rows } = await pool.query<{ score: number }>(
		"select similarity($1, $2) as score",
		[title, "Deploymnet"],
	);
	expect(rows[0]?.score).toBeGreaterThan(0.25);
	expect(rows[0]?.score).toBeLessThan(0.3);
	const suggestions = await suggestWikiPages(
		{
			userId: "search-test",
			isAdmin: false,
			readableSpaceIds: new Set([space.id]),
			hiddenPageIds: new Set(),
		},
		"Deploymnet",
	);
	expect(suggestions.map((suggestion) => suggestion.title)).toContain(title);
});
