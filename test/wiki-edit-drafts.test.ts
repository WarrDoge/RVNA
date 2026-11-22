import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	doc,
	rows,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let alice: Client;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("D");
	alice = await wiki.user("alice");
	await wiki.grant(space.id, { userId: alice.id }, ["read", "create"]);
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

describe("drafts", () => {
	test("a failed draft-page delete keeps the draft row", async () => {
		const created = await alice.post("/api/wiki/pages/drafts", {
			spaceKey: space.key,
		});
		const pageId = created.body.pageId as string;
		await alice.put(`/api/wiki/pages/${pageId}/draft`, {
			title: "Draft delete failure",
			bodyDoc: doc("x"),
		});
		await pool.query("drop trigger if exists test_block_page_delete on pages");
		await pool.query("drop function if exists test_block_page_delete()");
		await pool.query(
			"create function test_block_page_delete() returns trigger language plpgsql as $$ begin raise exception 'blocked'; end $$",
		);
		await pool.query(
			"create trigger test_block_page_delete before delete on pages for each row execute function test_block_page_delete()",
		);
		try {
			expect((await alice.del(`/api/wiki/pages/${pageId}/draft`)).status).toBe(
				500,
			);
			expect(
				await rows(
					"select 1 from page_drafts where page_id = $1 and user_id = $2",
					[pageId, alice.id],
				),
			).toHaveLength(1);
		} finally {
			await pool.query(
				"drop trigger if exists test_block_page_delete on pages",
			);
			await pool.query("drop function if exists test_block_page_delete()");
		}
		expect((await alice.del(`/api/wiki/pages/${pageId}/draft`)).status).toBe(
			204,
		);
	});

	test("concurrent create-draft requests reuse one untouched draft", async () => {
		const race = await wiki.space("C");
		await wiki.grant(race.id, { userId: alice.id }, ["read", "create"]);
		const replies = await Promise.all(
			Array.from({ length: 6 }, () =>
				alice.post("/api/wiki/pages/drafts", { spaceKey: race.key }),
			),
		);
		expect(new Set(replies.map((reply) => reply.body.pageId)).size).toBe(1);
		expect(
			await rows(
				"select 1 from pages where space_id = $1 and creator_id = $2 and status = 'draft'",
				[race.id, alice.id],
			),
		).toHaveLength(1);
	});
});
