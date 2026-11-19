import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	multipart,
	rows,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let target: TestSpace;
let editor: Client;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("S");
	target = await wiki.space("T");
	editor = await wiki.user("editor");
	for (const s of [space, target]) {
		await wiki.grant(s.id, { userId: editor.id }, ["read", "create", "delete"]);
	}
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

const mk = (title: string, parentId?: string | null, spaceKey = space.key) =>
	wiki.page(editor, spaceKey, title, { parentId });

const childrenOf = async (parentId: string) =>
	(
		await rows<{ title: string }>(
			"select title from pages where parent_id = $1 and status = 'current' order by position, title",
			[parentId],
		)
	).map((row) => row.title);

describe("move", () => {
	test("repositions among siblings and under a new parent", async () => {
		const parent = await mk("Move parent");
		const a = await mk("Move A", parent.id);
		const b = await mk("Move B", parent.id);
		const c = await mk("Move C", parent.id);
		expect(await childrenOf(parent.id)).toEqual(["Move A", "Move B", "Move C"]);

		const first = await editor.post(`/api/wiki/pages/${c.id}/move`, {
			position: 0,
		});
		expect(first.status).toBe(200);
		expect(await childrenOf(parent.id)).toEqual(["Move C", "Move A", "Move B"]);

		const deeper = await editor.post(`/api/wiki/pages/${a.id}/move`, {
			parentId: b.id,
		});
		expect(deeper.body.parentId).toBe(b.id);
		expect(await childrenOf(parent.id)).toEqual(["Move C", "Move B"]);
		expect(await childrenOf(b.id)).toEqual(["Move A"]);

		const toRoot = await editor.post(`/api/wiki/pages/${a.id}/move`, {
			parentId: null,
		});
		expect(toRoot.body.parentId).toBeNull();
	});

	test("concurrent moves into one parent keep positions unique", async () => {
		const parent = await mk("Concurrent parent");
		const pages = await Promise.all(
			Array.from({ length: 10 }, (_, index) => mk(`Concurrent child ${index}`)),
		);
		const responses = await Promise.all(
			pages.map((page) =>
				editor.post(`/api/wiki/pages/${page.id}/move`, {
					parentId: parent.id,
				}),
			),
		);
		expect(responses.map((response) => response.status)).toEqual(
			Array(10).fill(200),
		);
		const positions = (
			await rows<{ position: number }>(
				"select position from pages where parent_id = $1 and status = 'current' order by position",
				[parent.id],
			)
		).map((row) => row.position);
		expect(positions).toEqual(Array.from({ length: 10 }, (_, index) => index));
	});

	test("refuses to move a page under itself or a descendant", async () => {
		const top = await mk("Cycle top");
		const mid = await mk("Cycle mid", top.id);
		const leaf = await mk("Cycle leaf", mid.id);
		for (const parentId of [top.id, mid.id, leaf.id]) {
			const refused = await editor.post(`/api/wiki/pages/${top.id}/move`, {
				parentId,
			});
			expect(refused.status).toBe(400);
		}
	});

	test("moves to another space together with every descendant", async () => {
		const top = await mk("Cross top");
		const mid = await mk("Cross mid", top.id);
		const leaf = await mk("Cross leaf", mid.id);
		const moved = await editor.post(`/api/wiki/pages/${top.id}/move`, {
			spaceKey: target.key,
			parentId: target.homeId,
		});
		expect(moved.status).toBe(200);
		expect(moved.body.spaceKey).toBe(target.key);
		const inTarget = await rows<{ id: string }>(
			"select id from pages where space_id = $1 and id = any($2)",
			[target.id, [top.id, mid.id, leaf.id]],
		);
		expect(inTarget).toHaveLength(3);
		const [leafRow] = await rows("select parent_id from pages where id = $1", [
			leaf.id,
		]);
		expect(leafRow.parent_id).toBe(mid.id);
	});

	test("a title clash in the target space is a 409 that names the title", async () => {
		await mk("Clash me", null, target.key);
		const top = await mk("Clash top");
		await mk("Clash me", top.id);
		const refused = await editor.post(`/api/wiki/pages/${top.id}/move`, {
			spaceKey: target.key,
		});
		expect(refused.status).toBe(409);
		expect(refused.body.error).toContain('"Clash me"');
		const [row] = await rows("select space_id from pages where id = $1", [
			top.id,
		]);
		expect(row.space_id).toBe(space.id);
	});

	test("needs create permission in the target space", async () => {
		const lonely = await wiki.space("U");
		const page = await mk("Cannot leave");
		const refused = await editor.post(`/api/wiki/pages/${page.id}/move`, {
			spaceKey: lonely.key,
		});
		expect(refused.status).toBe(403);
	});

	test("moving under a page whose edit restriction excludes the mover works", async () => {
		const parent = await mk("Restricted parent");
		const page = await mk("Move under restricted");
		await wiki.admin.put(`/api/wiki/pages/${parent.id}/restrictions`, {
			read: { userIds: [], groups: [] },
			update: { userIds: [wiki.admin.id], groups: [] },
		});
		const moved = await editor.post(`/api/wiki/pages/${page.id}/move`, {
			parentId: parent.id,
		});
		expect(moved.status).toBe(200);
		expect(moved.body.parentId).toBe(parent.id);
	});
});

const positionsUnder = async (parentId: string) =>
	(
		await rows<{ position: number }>(
			"select position from pages where parent_id = $1 and status = 'current' order by position",
			[parentId],
		)
	).map((row) => row.position);

describe("concurrent position writes", () => {
	test("ten pages created at once under one parent get ten positions", async () => {
		const parent = await mk("Create race parent");
		await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				mk(`Create race child ${index}`, parent.id),
			),
		);
		expect(await positionsUnder(parent.id)).toEqual(
			Array.from({ length: 10 }, (_, index) => index),
		);
	});

	test("ten copies made at once under one parent get ten positions", async () => {
		const parent = await mk("Copy race parent");
		const source = await mk("Copy race source");
		const responses = await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				editor.post(`/api/wiki/pages/${source.id}/copy`, {
					title: `Copy race ${index}`,
					parentId: parent.id,
				}),
			),
		);
		expect(responses.map((response) => response.status)).toEqual(
			Array(10).fill(201),
		);
		expect(await positionsUnder(parent.id)).toEqual(
			Array.from({ length: 10 }, (_, index) => index),
		);
	});
});

describe("copy", () => {
	test("copies a tree with labels and attachments; colliding titles get a suffix", async () => {
		const top = await mk("Copy top");
		const child = await mk("Copy child", top.id);
		await mk("Copy grandchild", child.id);
		await editor.put(`/api/wiki/pages/${top.id}/labels`, { labels: ["keep"] });
		const upload = multipart({
			name: "note.txt",
			type: "text/plain",
			content: "attached",
		});
		const uploaded = await editor.raw(
			"POST",
			`/api/wiki/pages/${top.id}/attachments`,
			upload.payload,
			upload.contentType,
		);
		expect(uploaded.status).toBe(201);

		const copied = await editor.post(`/api/wiki/pages/${top.id}/copy`, {
			title: "Copy of top",
			withChildren: true,
			withAttachments: true,
			withLabels: true,
		});
		expect(copied.status).toBe(201);
		expect(copied.body).toMatchObject({
			title: "Copy of top",
			version: 1,
			parentId: space.homeId,
		});
		expect(await childrenOf(copied.body.id)).toEqual(["Copy child (copy)"]);
		const [grandchild] = await rows(
			"select p.title from pages p join pages c on c.id = p.parent_id where c.parent_id = $1",
			[copied.body.id],
		);
		expect(grandchild.title).toBe("Copy grandchild (copy)");

		const labels = await rows(
			"select label from page_labels where page_id = $1",
			[copied.body.id],
		);
		expect(labels.map((l) => l.label)).toEqual(["keep"]);
		const files = await rows(
			"select file_name, storage_path from page_attachments where page_id = any($1) order by page_id",
			[[top.id, copied.body.id]],
		);
		expect(files).toHaveLength(2);
		expect(files[0].storage_path).toBe(files[1].storage_path);
		const versions = await rows(
			"select number from page_versions where page_id = $1",
			[copied.body.id],
		);
		expect(versions).toHaveLength(1);
	});

	test("without options copies only the page; the title must be free", async () => {
		const top = await mk("Plain copy source");
		await mk("Plain copy child", top.id);
		const taken = await editor.post(`/api/wiki/pages/${top.id}/copy`, {
			title: "Plain copy source",
		});
		expect(taken.status).toBe(409);
		const copied = await editor.post(`/api/wiki/pages/${top.id}/copy`, {
			title: "Plain copy",
			spaceKey: target.key,
		});
		expect(copied.status).toBe(201);
		expect(copied.body.spaceKey).toBe(target.key);
		expect(await childrenOf(copied.body.id)).toEqual([]);
	});

	test("a copy keeps its attachments after the original is purged", async () => {
		const top = await mk("Image source");
		const upload = multipart({
			name: "pic.png",
			type: "image/png",
			content: "png-bytes",
		});
		await editor.raw(
			"POST",
			`/api/wiki/pages/${top.id}/attachments`,
			upload.payload,
			upload.contentType,
		);
		const copied = await editor.post(`/api/wiki/pages/${top.id}/copy`, {
			title: "Image copy",
			withAttachments: true,
		});
		await wiki.admin.post(`/api/wiki/pages/${top.id}/trash`);
		expect((await wiki.admin.del(`/api/wiki/pages/${top.id}`)).status).toBe(
			204,
		);
		const left = await rows(
			"select storage_path from page_attachments where page_id = $1",
			[copied.body.id],
		);
		expect(left).toHaveLength(1);
		await access(
			join(process.env.ATTACHMENTS_DIR as string, left[0].storage_path),
		);
	});
});

describe("trash", () => {
	test("children move up to the parent, restore puts the page back", async () => {
		const parent = await mk("Trash parent");
		const before = await mk("Trash before", parent.id);
		const victim = await mk("Trash victim", parent.id);
		const kid1 = await mk("Trash kid 1", victim.id);
		await mk("Trash kid 2", victim.id);
		const after = await mk("Trash after", parent.id);

		const trashed = await editor.post(`/api/wiki/pages/${victim.id}/trash`);
		expect(trashed.status).toBe(200);
		expect(trashed.body.status).toBe("trashed");
		expect(await childrenOf(parent.id)).toEqual([
			"Trash before",
			"Trash after",
			"Trash kid 1",
			"Trash kid 2",
		]);
		const [kidRow] = await rows("select parent_id from pages where id = $1", [
			kid1.id,
		]);
		expect(kidRow.parent_id).toBe(parent.id);

		const listed = await editor.get(`/api/wiki/edit/trash/${space.key}`);
		expect(
			listed.body.map((e: { page: { id: string } }) => e.page.id),
		).toContain(victim.id);

		const restored = await editor.post(`/api/wiki/pages/${victim.id}/restore`);
		expect(restored.status).toBe(200);
		expect(restored.body).toMatchObject({
			status: "current",
			parentId: parent.id,
		});
		expect(await childrenOf(parent.id)).toEqual([
			"Trash before",
			"Trash victim",
			"Trash after",
			"Trash kid 1",
			"Trash kid 2",
		]);
		expect(before.id).not.toBe(after.id);
		expect(
			await rows("select * from page_trash where page_id = $1", [victim.id]),
		).toHaveLength(0);
	});

	test("restores under the space root when the original parent is gone", async () => {
		const parent = await mk("Gone parent");
		const child = await mk("Orphaned child", parent.id);
		await editor.post(`/api/wiki/pages/${child.id}/trash`);
		await editor.post(`/api/wiki/pages/${parent.id}/trash`);
		const restored = await editor.post(`/api/wiki/pages/${child.id}/restore`);
		expect(restored.status).toBe(200);
		expect(restored.body.parentId).toBeNull();
	});

	test("the home page cannot be trashed; only trashed pages can be purged", async () => {
		const home = await wiki.admin.post(`/api/wiki/pages/${space.homeId}/trash`);
		expect(home.status).toBe(409);
		const page = await mk("Purge candidate");
		const early = await wiki.admin.del(`/api/wiki/pages/${page.id}`);
		expect(early.status).toBe(409);
		const notTrashed = await editor.post(`/api/wiki/pages/${page.id}/restore`);
		expect(notTrashed.status).toBe(409);
	});

	test("purge needs the space admin and removes the page with its rows", async () => {
		const page = await mk("Purge me");
		await editor.put(`/api/wiki/pages/${page.id}/labels`, { labels: ["x"] });
		await editor.post(`/api/wiki/pages/${page.id}/trash`);
		const refused = await editor.del(`/api/wiki/pages/${page.id}`);
		expect(refused.status).toBe(403);
		const purged = await wiki.admin.del(`/api/wiki/pages/${page.id}`);
		expect(purged.status).toBe(204);
		for (const table of [
			"pages",
			"page_versions",
			"page_labels",
			"page_trash",
		]) {
			const column = table === "pages" ? "id" : "page_id";
			expect(
				await rows(`select 1 from ${table} where ${column} = $1`, [page.id]),
			).toHaveLength(0);
		}
	});

	test("trash needs delete permission, or delete_own for pages the user created", async () => {
		const limited = await wiki.user("limited");
		await wiki.grant(space.id, { userId: limited.id }, [
			"read",
			"create",
			"delete_own",
		]);
		const mine = await wiki.page(limited, space.key, "Limited own");
		const theirs = await mk("Limited theirs");
		expect(
			(await limited.post(`/api/wiki/pages/${theirs.id}/trash`)).status,
		).toBe(403);
		expect(
			(await limited.post(`/api/wiki/pages/${mine.id}/trash`)).status,
		).toBe(200);
	});
});

describe("reorder", () => {
	test("sets the order of exactly the current children", async () => {
		const parent = await mk("Reorder parent");
		const a = await mk("R-a", parent.id);
		const b = await mk("R-b", parent.id);
		const c = await mk("R-c", parent.id);
		const ok = await editor.post(
			`/api/wiki/pages/${parent.id}/children/order`,
			{ childIds: [c.id, a.id, b.id] },
		);
		expect(ok.status).toBe(204);
		expect(await childrenOf(parent.id)).toEqual(["R-c", "R-a", "R-b"]);
		for (const childIds of [
			[a.id, b.id],
			[a.id, b.id, c.id, c.id],
			[a.id, b.id, parent.id],
		]) {
			const bad = await editor.post(
				`/api/wiki/pages/${parent.id}/children/order`,
				{ childIds },
			);
			expect(bad.status).toBe(400);
		}
	});
});
