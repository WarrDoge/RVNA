import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	doc,
	rows,
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

const backdate = (pageId: string, seconds: number) =>
	pool.query(
		"update page_locks set heartbeat_at = now() - make_interval(secs => $2) where page_id = $1",
		[pageId, seconds],
	);

describe("edit locks", () => {
	test("the first editor gets the lock, a second one is told who edits", async () => {
		const page = await wiki.page(alice, space.key, "Lock basics");
		const first = await alice.post(`/api/wiki/pages/${page.id}/lock`);
		expect(first.status).toBe(200);
		expect(first.body.acquired).toBe(true);
		expect(first.body.lock.holder.id).toBe(alice.id);
		expect(first.body.lock.expiresIn).toBeGreaterThan(100);
		expect(first.body.lock.expiresIn).toBeLessThanOrEqual(120);

		const again = await alice.post(`/api/wiki/pages/${page.id}/lock`);
		expect(again.body.acquired).toBe(true);

		const second = await bob.post(`/api/wiki/pages/${page.id}/lock`);
		expect(second.status).toBe(409);
		expect(second.body).toMatchObject({ acquired: false });
		expect(second.body.lock.holder.id).toBe(alice.id);

		const context = await bob.get(`/api/wiki/edit/pages/${page.id}`);
		expect(context.body.lock.holder.id).toBe(alice.id);
	});

	test("publishing is refused with 423 while another user holds a live lock", async () => {
		const page = await wiki.page(alice, space.key, "Lock publish");
		await alice.post(`/api/wiki/pages/${page.id}/lock`);
		const refused = await bob.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: doc("bob"),
		});
		expect(refused.status).toBe(423);
		expect(refused.body.lock.holder.id).toBe(alice.id);
		const rename = await bob.post(`/api/wiki/pages/${page.id}/rename`, {
			title: "Lock publish renamed",
		});
		expect(rename.status).toBe(423);
		const own = await alice.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: doc("alice"),
		});
		expect(own.status).toBe(200);
	});

	test("a lock expires two minutes after the last heartbeat", async () => {
		const page = await wiki.page(alice, space.key, "Lock expiry");
		await alice.post(`/api/wiki/pages/${page.id}/lock`);
		await backdate(page.id, 100);
		expect((await bob.post(`/api/wiki/pages/${page.id}/lock`)).status).toBe(
			409,
		);
		await backdate(page.id, 125);
		const context = await bob.get(`/api/wiki/edit/pages/${page.id}`);
		expect(context.body.lock).toBeNull();
		expect(
			(await bob.put(`/api/wiki/pages/${page.id}`, { bodyDoc: doc("bob") }))
				.status,
		).toBe(200);
		const acquired = await bob.post(`/api/wiki/pages/${page.id}/lock`);
		expect(acquired.body.acquired).toBe(true);
		expect(acquired.body.lock.holder.id).toBe(bob.id);
		const [row] = await rows(
			"select taken_over_from from page_locks where page_id = $1",
			[page.id],
		);
		expect(row.taken_over_from).toBeNull();
	});

	test("heartbeats refresh the own lock and report a lost one", async () => {
		const page = await wiki.page(alice, space.key, "Lock heartbeat");
		await alice.post(`/api/wiki/pages/${page.id}/lock`);
		await backdate(page.id, 90);
		const beat = await alice.post(`/api/wiki/pages/${page.id}/lock/heartbeat`);
		expect(beat.body.status).toBe("ok");
		expect(beat.body.lock.expiresIn).toBeGreaterThan(100);

		const lost = await bob.post(`/api/wiki/pages/${page.id}/lock/heartbeat`);
		expect(lost.status).toBe(200);
		expect(lost.body.status).toBe("lost");
		expect(lost.body.lock.holder.id).toBe(alice.id);
	});

	test("a lock is refused when the page is trashed while the request waits", async () => {
		const page = await wiki.page(alice, space.key, "Lock trashed race");
		const holder = await pool.connect();
		try {
			await holder.query("begin");
			await holder.query("select id from pages where id = $1 for update", [
				page.id,
			]);
			const pending = alice.post(`/api/wiki/pages/${page.id}/lock`);
			await waitForBlockedPages(1);
			await holder.query("update pages set status = 'trashed' where id = $1", [
				page.id,
			]);
			await holder.query("commit");
			expect((await pending).status).toBe(404);
		} finally {
			await holder.query("rollback").catch(() => undefined);
			holder.release();
		}
	});

	test("a heartbeat is refused when the page is trashed while it waits", async () => {
		const page = await wiki.page(alice, space.key, "Heartbeat trashed race");
		await alice.post(`/api/wiki/pages/${page.id}/lock`);
		const holder = await pool.connect();
		try {
			await holder.query("begin");
			await holder.query("select id from pages where id = $1 for update", [
				page.id,
			]);
			const pending = alice.post(`/api/wiki/pages/${page.id}/lock/heartbeat`);
			await waitForBlockedPages(1);
			await holder.query("update pages set status = 'trashed' where id = $1", [
				page.id,
			]);
			await holder.query("commit");
			expect((await pending).status).toBe(404);
		} finally {
			await holder.query("rollback").catch(() => undefined);
			holder.release();
		}
	});

	test("a heartbeat expires the lock when its holder lost edit permission", async () => {
		const hidden = await wiki.space("P");
		await wiki.grant(hidden.id, { userId: alice.id }, ["read", "create"]);
		const page = await wiki.page(alice, hidden.key, "Lock permission loss");
		expect(
			(await alice.post(`/api/wiki/pages/${page.id}/lock`)).body.acquired,
		).toBe(true);
		await pool.query(
			"delete from space_permissions where space_id = $1 and user_id = $2 and permission = 'create'",
			[hidden.id, alice.id],
		);
		const beat = await alice.post(`/api/wiki/pages/${page.id}/lock/heartbeat`);
		expect(beat.body).toEqual({ status: "expired", lock: null });
	});

	test("lock routes answer 404 for a page the caller cannot read", async () => {
		const page = await wiki.page(wiki.admin, space.key, "Hidden lock");
		await wiki.admin.put(`/api/wiki/pages/${page.id}/restrictions`, {
			read: { userIds: [alice.id], groups: [] },
			update: { userIds: [], groups: [] },
		});
		const responses = await Promise.all([
			bob.post(`/api/wiki/pages/${page.id}/lock`),
			bob.post(`/api/wiki/pages/${page.id}/lock/heartbeat`),
			bob.del(`/api/wiki/pages/${page.id}/lock`),
		]);
		for (const response of responses) {
			expect(response.status).toBe(404);
		}
	});

	test("taking over tells the first editor at the next heartbeat and keeps their draft", async () => {
		const page = await wiki.page(alice, space.key, "Lock takeover");
		await alice.post(`/api/wiki/pages/${page.id}/lock`);
		const saved = await alice.put(`/api/wiki/pages/${page.id}/draft`, {
			title: "Lock takeover",
			bodyDoc: doc("alice draft"),
		});
		expect(saved.status).toBe(200);

		const plain = await bob.post(`/api/wiki/pages/${page.id}/lock`);
		expect(plain.status).toBe(409);
		const taken = await bob.post(`/api/wiki/pages/${page.id}/lock`, {
			takeOver: true,
		});
		expect(taken.status).toBe(200);
		expect(taken.body.lock.holder.id).toBe(bob.id);
		const [row] = await rows(
			"select user_id, taken_over_from, taken_over_at from page_locks where page_id = $1",
			[page.id],
		);
		expect(row.user_id).toBe(bob.id);
		expect(row.taken_over_from).toBe(alice.id);
		expect(row.taken_over_at).not.toBeNull();

		const beat = await alice.post(`/api/wiki/pages/${page.id}/lock/heartbeat`);
		expect(beat.body.status).toBe("lost");
		expect(beat.body.lock.holder.id).toBe(bob.id);
		const draft = await alice.get(`/api/wiki/edit/pages/${page.id}`);
		expect(draft.body.draft.title).toBe("Lock takeover");
		expect(
			(await alice.put(`/api/wiki/pages/${page.id}`, { bodyDoc: doc("alice") }))
				.status,
		).toBe(423);
	});

	test("a heartbeat without a lock row takes the free lock again", async () => {
		const page = await wiki.page(alice, space.key, "Lock reacquire");
		const beat = await alice.post(`/api/wiki/pages/${page.id}/lock/heartbeat`);
		expect(beat.body.status).toBe("ok");
		expect(beat.body.lock.holder.id).toBe(alice.id);
		const stranger = await wiki.user("stranger");
		await wiki.grant(space.id, { userId: stranger.id }, ["read"]);
		const denied = await stranger.post(
			`/api/wiki/pages/${page.id}/lock/heartbeat`,
		);
		expect(denied.body.status).toBe("lost");
		await pool.query("delete from page_locks where page_id = $1", [page.id]);
		const expired = await stranger.post(
			`/api/wiki/pages/${page.id}/lock/heartbeat`,
		);
		expect(expired.body).toEqual({ status: "expired", lock: null });
	});

	test("release removes only the caller's lock", async () => {
		const page = await wiki.page(alice, space.key, "Lock release");
		await alice.post(`/api/wiki/pages/${page.id}/lock`);
		expect((await bob.del(`/api/wiki/pages/${page.id}/lock`)).status).toBe(204);
		expect(
			await rows("select 1 from page_locks where page_id = $1", [page.id]),
		).toHaveLength(1);
		expect((await alice.del(`/api/wiki/pages/${page.id}/lock`)).status).toBe(
			204,
		);
		expect(
			await rows("select 1 from page_locks where page_id = $1", [page.id]),
		).toHaveLength(0);
		expect(
			(await bob.post(`/api/wiki/pages/${page.id}/lock`)).body.acquired,
		).toBe(true);
	});

	test("a lock never blocks saving a draft", async () => {
		const page = await wiki.page(alice, space.key, "Lock draft");
		await alice.post(`/api/wiki/pages/${page.id}/lock`);
		const saved = await bob.put(`/api/wiki/pages/${page.id}/draft`, {
			title: "Lock draft",
			bodyDoc: doc("bob draft"),
		});
		expect(saved.status).toBe(200);
	});
});

describe("drafts", () => {
	test("autosave keeps one row per user and page, resume returns it", async () => {
		const page = await wiki.page(alice, space.key, "Draft resume", {
			labels: ["l1"],
		});
		const none = await alice.get(`/api/wiki/edit/pages/${page.id}`);
		expect(none.body.draft).toBeNull();
		expect(none.body.page.bodyDoc.type).toBe("doc");
		expect(none.body.labels).toEqual(["l1"]);

		const first = await alice.put(`/api/wiki/pages/${page.id}/draft`, {
			title: "Draft resume",
			bodyDoc: doc("one"),
			labels: ["L2"],
		});
		const second = await alice.put(`/api/wiki/pages/${page.id}/draft`, {
			title: "Draft resume v2",
			bodyDoc: doc("two"),
			baseVersion: 1,
		});
		expect(second.body.id).toBe(first.body.id);
		expect(
			await rows("select 1 from page_drafts where page_id = $1", [page.id]),
		).toHaveLength(1);

		const context = await alice.get(`/api/wiki/edit/pages/${page.id}`);
		expect(context.body.draft).toMatchObject({
			id: first.body.id,
			pageId: page.id,
			title: "Draft resume v2",
			baseVersion: 1,
			spaceKey: space.key,
		});
		expect(context.body.draft.bodyDoc.content[0].content[0].text).toBe("two");
		const byId = await alice.get(`/api/wiki/edit/drafts/${first.body.id}`);
		expect(byId.status).toBe(200);
		expect(byId.body.draft.id).toBe(first.body.id);
		expect(byId.body.page.id).toBe(page.id);

		expect(
			(await bob.get(`/api/wiki/edit/drafts/${first.body.id}`)).status,
		).toBe(404);
		expect(
			(await bob.get(`/api/wiki/edit/pages/${page.id}`)).body.draft,
		).toBeNull();
	});

	test("publishing removes the author's draft; discarding keeps the published page", async () => {
		const page = await wiki.page(alice, space.key, "Draft publish");
		await alice.put(`/api/wiki/pages/${page.id}/draft`, {
			title: "Draft publish",
			bodyDoc: doc("x"),
		});
		await alice.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: doc("published"),
			baseVersion: 1,
		});
		expect(
			await rows("select 1 from page_drafts where page_id = $1", [page.id]),
		).toHaveLength(0);

		await alice.put(`/api/wiki/pages/${page.id}/draft`, {
			title: "Draft publish",
			bodyDoc: doc("y"),
		});
		expect((await alice.del(`/api/wiki/pages/${page.id}/draft`)).status).toBe(
			204,
		);
		expect(
			await rows("select 1 from page_drafts where page_id = $1", [page.id]),
		).toHaveLength(0);
		expect(
			await rows("select 1 from pages where id = $1", [page.id]),
		).toHaveLength(1);
	});

	test("an unpublished page is reused while untouched and deleted when discarded", async () => {
		const created = await alice.post("/api/wiki/pages/drafts", {
			spaceKey: space.key,
		});
		expect(created.status).toBe(201);
		const again = await alice.post("/api/wiki/pages/drafts", {
			spaceKey: space.key,
		});
		expect(again.status).toBe(200);
		expect(again.body).toEqual(created.body);

		const stranger = await bob.put(
			`/api/wiki/pages/${created.body.pageId}/draft`,
			{ title: "x", bodyDoc: doc("x") },
		);
		expect(stranger.status).toBe(404);
		expect(
			(await bob.del(`/api/wiki/pages/${created.body.pageId}/draft`)).status,
		).toBe(404);
		expect(
			await rows("select 1 from pages where id = $1", [created.body.pageId]),
		).toHaveLength(1);

		await alice.put(`/api/wiki/pages/${created.body.pageId}/draft`, {
			title: "Typed title",
			bodyDoc: doc("typed"),
		});
		const touched = await alice.post("/api/wiki/pages/drafts", {
			spaceKey: space.key,
		});
		expect(touched.body.pageId).not.toBe(created.body.pageId);

		const context = await alice.get(
			`/api/wiki/edit/drafts/${created.body.draftId}`,
		);
		expect(context.body.page).toMatchObject({ status: "draft", version: 0 });
		expect(context.body.draft.title).toBe("Typed title");
		expect(
			(await bob.get(`/api/wiki/edit/pages/${created.body.pageId}`)).status,
		).toBe(404);

		expect(
			(await alice.del(`/api/wiki/pages/${created.body.pageId}/draft`)).status,
		).toBe(204);
		expect(
			await rows("select 1 from pages where id = $1", [created.body.pageId]),
		).toHaveLength(0);
		expect(
			(await alice.del(`/api/wiki/pages/${created.body.pageId}/draft`)).status,
		).toBe(404);
		await alice.del(`/api/wiki/pages/${touched.body.pageId}/draft`);
	});

	test("invalid drafts are refused", async () => {
		const page = await wiki.page(alice, space.key, "Draft invalid");
		const bad = await alice.put(`/api/wiki/pages/${page.id}/draft`, {
			title: "t",
			bodyDoc: { type: "doc", content: [{ type: "bogus" }] },
		});
		expect(bad.status).toBe(400);
		const stranger = await wiki.user("nodraft");
		const denied = await stranger.put(`/api/wiki/pages/${page.id}/draft`, {
			title: "t",
			bodyDoc: doc("x"),
		});
		expect(denied.status).toBe(404);
	});
});
