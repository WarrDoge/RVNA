import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	rows,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

const run = promisify(execFile);
let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let author: Client;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("CV");
	author = await wiki.user("author");
	await wiki.grant(space.id, { userId: author.id }, ["read", "create"]);
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

test("every pending version is converted from the same read", async () => {
	const page = await wiki.page(author, space.key, "Several versions");
	await pool.query(
		"update pages set body_doc = null, body_storage = $1 where id = $2",
		["<p>page body</p>", page.id],
	);
	await pool.query(
		"update page_versions set body_doc = null, body_storage = $1 where page_id = $2 and number = 1",
		["<p>version one</p>", page.id],
	);
	for (const number of [2, 3]) {
		await pool.query(
			"insert into page_versions (source_id, page_id, number, title, body_storage, author_id) values ($1, $2, $3, $4, $5, $6)",
			[
				`fat:test-${wiki.run}-version-${number}`,
				page.id,
				number,
				"Several versions",
				`<p>version ${number}</p>`,
				author.id,
			],
		);
	}

	await run(process.execPath, ["src/lib/server/wiki-edit/convert-all.ts"], {
		cwd: process.cwd(),
		env: { ...process.env },
		timeout: 30_000,
	});

	const stored = await rows<{ number: number; body_doc: unknown }>(
		"select number, body_doc from page_versions where page_id = $1 order by number",
		[page.id],
	);
	expect(stored).toHaveLength(3);
	for (const version of stored) {
		expect(version.body_doc).toMatchObject({ type: "doc" });
		expect(JSON.stringify(version.body_doc)).toContain(
			version.number === 1 ? "version one" : `version ${version.number}`,
		);
	}
});

test("a second run does not overwrite a document that already exists", async () => {
	const page = await wiki.page(author, space.key, "Already converted");
	const authored = {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text: "AUTHORED" }],
			},
		],
	};
	await pool.query(
		"update pages set body_doc = $1::jsonb, body_storage = $2 where id = $3",
		[JSON.stringify(authored), "<p>from storage</p>", page.id],
	);
	await pool.query(
		"update page_versions set body_doc = null, body_storage = $1 where page_id = $2 and number = 1",
		["<p>from storage</p>", page.id],
	);

	await run(process.execPath, ["src/lib/server/wiki-edit/convert-all.ts"], {
		cwd: process.cwd(),
		env: { ...process.env },
		timeout: 30_000,
	});

	const [stored] = await rows<{ body_doc: unknown }>(
		"select body_doc from pages where id = $1",
		[page.id],
	);
	expect(stored.body_doc).toEqual(authored);
	const [version] = await rows<{ body_doc: { type?: string } | null }>(
		"select body_doc from page_versions where page_id = $1 and number = 1",
		[page.id],
	);
	expect(version.body_doc?.type).toBe("doc");
});
