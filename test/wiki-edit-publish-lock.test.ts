import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	doc,
	setupWiki,
	type TestSpace,
	waitForBlockedPages,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let alice: Client;
let bob: Client;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("L");
	alice = await wiki.user("alice");
	bob = await wiki.user("bob");
	for (const user of [alice, bob]) {
		await wiki.grant(space.id, { userId: user.id }, ["read", "create"]);
	}
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

describe("publishing under a lock", () => {
	test("refuses a lock another user took while the publish waited", async () => {
		const page = await wiki.page(alice, space.key, "Lock publish race");
		const holder = await pool.connect();
		try {
			await holder.query("begin");
			await holder.query("select id from pages where id = $1 for update", [
				page.id,
			]);
			const lock = alice.post(`/api/wiki/pages/${page.id}/lock`);
			await waitForBlockedPages(1);
			const publish = bob.put(`/api/wiki/pages/${page.id}`, {
				bodyDoc: doc("bob"),
			});
			await waitForBlockedPages(2);
			await holder.query("commit");
			const [acquired, published] = await Promise.all([lock, publish]);
			expect(acquired.status).toBe(200);
			expect(published.status).toBe(423);
		} finally {
			await holder.query("rollback").catch(() => undefined);
			holder.release();
		}
	});
});
