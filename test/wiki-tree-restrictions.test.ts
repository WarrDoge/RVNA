import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	rows,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let other: TestSpace;
let editor: Client;
let alice: Client;
let carol: Client;
let outsider: Client;
let restricter: Client;
let staffEditor: Client;
let staffGroup: string;
let count = 0;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("RA");
	other = await wiki.space("RB");
	staffGroup = `t-${wiki.run}-staff`;
	editor = await wiki.user("editor");
	alice = await wiki.user("alice");
	carol = await wiki.user("carol");
	outsider = await wiki.user("outsider");
	restricter = await wiki.user("restricter");
	staffEditor = await wiki.user("staff-editor", [staffGroup]);
	for (const s of [space, other]) {
		for (const client of [editor, alice, carol, staffEditor]) {
			await wiki.grant(s.id, { userId: client.id }, [
				"read",
				"create",
				"delete",
			]);
		}
		await wiki.grant(s.id, { userId: restricter.id }, [
			"read",
			"create",
			"delete",
			"restrict",
		]);
		await wiki.grant(s.id, { userId: outsider.id }, ["read", "create"]);
	}
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

/** A page with a body that carries a token no other page has. */
async function mk(
	name: string,
	parentId: string | null = null,
	spaceKey = space.key,
) {
	const token = `zq${wiki.run}${++count}`;
	const page = await wiki.page(wiki.admin, spaceKey, `${name} ${token}`, {
		parentId,
	});
	return { ...page, token };
}

const restrict = (
	pageId: string,
	read: { userIds?: string[]; groups?: string[] },
) =>
	wiki.admin.put(`/api/wiki/pages/${pageId}/restrictions`, {
		read: { userIds: read.userIds ?? [], groups: read.groups ?? [] },
		update: { userIds: [], groups: [] },
	});

const ownReaders = async (pageId: string) =>
	(
		await rows<{ user_id: string | null; group_name: string | null }>(
			"select user_id, group_name from page_restrictions where page_id = $1 and operation = 'read' order by user_id, group_name",
			[pageId],
		)
	)
		.map((row) => row.user_id ?? row.group_name)
		.sort();

/** What a user without access to the restricted branch can still reach of a page. */
async function reach(client: Client, pageId: string, token: string) {
	const tree = await client.get(`/api/wiki/edit/space-tree/${space.key}`);
	const search = await client.get(
		`/api/wiki/search?query=${encodeURIComponent(token)}`,
	);
	const copy = await client.post(`/api/wiki/pages/${pageId}/copy`, {
		title: `Probe ${token} ${++count}`,
	});
	return {
		page: (await client.get(`/api/wiki/pages/${pageId}`)).status,
		inTree: (tree.body as { id: string }[]).some((node) => node.id === pageId),
		inSearch: (search.body.hits as { id: string }[]).some(
			(hit) => hit.id === pageId,
		),
		copy: copy.status,
	};
}

const hidden = { page: 404, inTree: false, inSearch: false, copy: 404 };
const readable = { page: 200, inTree: true, inSearch: true, copy: 201 };

/** A page Y that only editor and alice may read, with a body page and a grandchild below it. */
async function restrictedBranch(readers = [editor.id, alice.id]) {
	const top = await mk("Restricted top");
	await restrict(top.id, { userIds: readers });
	const leaf = await mk("Restricted leaf", top.id);
	const grandchild = await mk("Restricted grandchild", leaf.id);
	return { top, leaf, grandchild };
}

describe("move out of a restricted page", () => {
	test("keeps the readers when the mover may not change restrictions", async () => {
		const { top, leaf, grandchild } = await restrictedBranch();
		const moved = await editor.post(`/api/wiki/pages/${leaf.id}/move`, {
			parentId: null,
		});
		expect(moved.status).toBe(200);
		expect(moved.body.parentId).toBeNull();
		for (const page of [leaf, grandchild]) {
			expect(await reach(outsider, page.id, page.token)).toEqual(hidden);
			expect((await editor.get(`/api/wiki/pages/${page.id}`)).status).toBe(200);
			expect((await alice.get(`/api/wiki/pages/${page.id}`)).status).toBe(200);
		}
		expect(await ownReaders(leaf.id)).toEqual([editor.id, alice.id].sort());
		expect(await ownReaders(top.id)).toEqual([editor.id, alice.id].sort());
	});

	test("a page with its own restriction keeps only the readers of both", async () => {
		const { leaf } = await restrictedBranch([editor.id, alice.id]);
		await restrict(leaf.id, { userIds: [editor.id, alice.id, carol.id] });
		const moved = await editor.post(`/api/wiki/pages/${leaf.id}/move`, {
			parentId: null,
		});
		expect(moved.status).toBe(200);
		expect(await ownReaders(leaf.id)).toEqual([editor.id, alice.id].sort());
		expect(await reach(outsider, leaf.id, leaf.token)).toEqual(hidden);
		expect((await carol.get(`/api/wiki/pages/${leaf.id}`)).status).toBe(404);
		expect((await alice.get(`/api/wiki/pages/${leaf.id}`)).status).toBe(200);
	});

	test("takes the readers of every restricted page it leaves", async () => {
		const outer = await mk("Outer restricted");
		await restrict(outer.id, { userIds: [editor.id, alice.id, carol.id] });
		const inner = await mk("Inner restricted", outer.id);
		await restrict(inner.id, { userIds: [editor.id, alice.id] });
		const leaf = await mk("Doubly restricted leaf", inner.id);
		const moved = await editor.post(`/api/wiki/pages/${leaf.id}/move`, {
			parentId: null,
		});
		expect(moved.status).toBe(200);
		expect(await ownReaders(leaf.id)).toEqual([editor.id, alice.id].sort());
		expect(await reach(outsider, leaf.id, leaf.token)).toEqual(hidden);
		expect((await carol.get(`/api/wiki/pages/${leaf.id}`)).status).toBe(404);
	});

	test("is refused when the restrictions cannot be kept", async () => {
		const outer = await mk("Group restricted");
		await restrict(outer.id, { groups: [staffGroup] });
		const inner = await mk("User restricted", outer.id);
		await restrict(inner.id, { userIds: [staffEditor.id] });
		const leaf = await mk("Hard to keep", inner.id);
		const refused = await staffEditor.post(`/api/wiki/pages/${leaf.id}/move`, {
			parentId: null,
		});
		expect(refused.status).toBe(403);
		const [row] = await rows("select parent_id from pages where id = $1", [
			leaf.id,
		]);
		expect(row.parent_id).toBe(inner.id);
	});

	test("someone who may change restrictions can move the page out", async () => {
		const top = await mk("Lifted top");
		await restrict(top.id, { userIds: [editor.id, restricter.id] });
		const leaf = await mk("Lifted leaf", top.id);
		const moved = await restricter.post(`/api/wiki/pages/${leaf.id}/move`, {
			parentId: null,
		});
		expect(moved.status).toBe(200);
		expect(await ownReaders(leaf.id)).toEqual([]);
		expect(await reach(outsider, leaf.id, leaf.token)).toEqual(readable);
	});

	test("a move that keeps the restricted page above the page changes nothing", async () => {
		const { top, leaf, grandchild } = await restrictedBranch();
		const sibling = await mk("Restricted sibling", top.id);
		const moved = await editor.post(`/api/wiki/pages/${leaf.id}/move`, {
			parentId: sibling.id,
		});
		expect(moved.status).toBe(200);
		expect(await ownReaders(leaf.id)).toEqual([]);
		expect(await reach(outsider, grandchild.id, grandchild.token)).toEqual(
			hidden,
		);
	});

	test("a move to another space keeps the readers", async () => {
		const { leaf } = await restrictedBranch();
		const moved = await editor.post(`/api/wiki/pages/${leaf.id}/move`, {
			spaceKey: other.key,
		});
		expect(moved.status).toBe(200);
		expect(moved.body.spaceKey).toBe(other.key);
		expect((await outsider.get(`/api/wiki/pages/${leaf.id}`)).status).toBe(404);
		expect((await alice.get(`/api/wiki/pages/${leaf.id}`)).status).toBe(200);
		expect(await ownReaders(leaf.id)).toEqual([editor.id, alice.id].sort());
	});
});

describe("copy of a page under a restricted page", () => {
	test("the copy and its descendants are no more readable than the source", async () => {
		const { leaf, grandchild } = await restrictedBranch();
		const copied = await editor.post(`/api/wiki/pages/${leaf.id}/copy`, {
			title: `Copy of ${leaf.title}`,
			parentId: null,
			withChildren: true,
		});
		expect(copied.status).toBe(201);
		const [below] = await rows<{ id: string; title: string }>(
			"select id, title from pages where parent_id = $1",
			[copied.body.id],
		);
		expect(below).toBeDefined();
		expect(await ownReaders(copied.body.id)).toEqual(
			[editor.id, alice.id].sort(),
		);
		expect(await reach(outsider, copied.body.id, leaf.token)).toEqual(hidden);
		expect(await reach(outsider, below.id, grandchild.token)).toEqual(hidden);
		expect((await alice.get(`/api/wiki/pages/${copied.body.id}`)).status).toBe(
			200,
		);
	});

	test("a page with its own restriction keeps the readers of both", async () => {
		const { leaf } = await restrictedBranch([editor.id, alice.id]);
		await restrict(leaf.id, { userIds: [editor.id, alice.id, carol.id] });
		const copied = await editor.post(`/api/wiki/pages/${leaf.id}/copy`, {
			title: `Own and inherited ${leaf.token}`,
			parentId: null,
		});
		expect(copied.status).toBe(201);
		expect(await ownReaders(copied.body.id)).toEqual(
			[editor.id, alice.id].sort(),
		);
		expect((await carol.get(`/api/wiki/pages/${copied.body.id}`)).status).toBe(
			404,
		);
		expect(
			(await outsider.get(`/api/wiki/pages/${copied.body.id}`)).status,
		).toBe(404);
	});

	test("a copy to another space is restricted too", async () => {
		const { leaf } = await restrictedBranch();
		const copied = await editor.post(`/api/wiki/pages/${leaf.id}/copy`, {
			title: `Elsewhere ${leaf.token}`,
			spaceKey: other.key,
		});
		expect(copied.status).toBe(201);
		expect(
			(await outsider.get(`/api/wiki/pages/${copied.body.id}`)).status,
		).toBe(404);
	});

	test("a space administrator's copy is restricted as well", async () => {
		const { leaf } = await restrictedBranch();
		const copied = await wiki.admin.post(`/api/wiki/pages/${leaf.id}/copy`, {
			title: `Admin copy ${leaf.token}`,
			parentId: null,
		});
		expect(copied.status).toBe(201);
		expect(await ownReaders(copied.body.id)).toEqual(
			[editor.id, alice.id].sort(),
		);
		expect(
			(await outsider.get(`/api/wiki/pages/${copied.body.id}`)).status,
		).toBe(404);
	});

	test("a copy under the same restricted page needs no restriction of its own", async () => {
		const { top, leaf } = await restrictedBranch();
		const copied = await editor.post(`/api/wiki/pages/${leaf.id}/copy`, {
			title: `Beside ${leaf.token}`,
			parentId: top.id,
		});
		expect(copied.status).toBe(201);
		expect(await ownReaders(copied.body.id)).toEqual([]);
		expect(
			(await outsider.get(`/api/wiki/pages/${copied.body.id}`)).status,
		).toBe(404);
	});

	test("is refused when the restrictions cannot be kept", async () => {
		const outer = await mk("Copy group restricted");
		await restrict(outer.id, { groups: [staffGroup] });
		const inner = await mk("Copy user restricted", outer.id);
		await restrict(inner.id, { userIds: [staffEditor.id] });
		const leaf = await mk("Copy hard to keep", inner.id);
		const refused = await staffEditor.post(`/api/wiki/pages/${leaf.id}/copy`, {
			title: `Refused ${leaf.token}`,
			parentId: null,
		});
		expect(refused.status).toBe(403);
		expect(
			await rows("select 1 from pages where title = $1", [
				`Refused ${leaf.token}`,
			]),
		).toHaveLength(0);
	});
});

describe("trash and restore", () => {
	test("a page with a read restriction and children is not trashed by a member", async () => {
		const parent = await mk("Board pack");
		await restrict(parent.id, { userIds: [editor.id, alice.id] });
		const child = await mk("Board child", parent.id);
		const refused = await editor.post(`/api/wiki/pages/${parent.id}/trash`);
		expect(refused.status).toBe(403);
		const [row] = await rows("select parent_id from pages where id = $1", [
			child.id,
		]);
		expect(row.parent_id).toBe(parent.id);
		expect(await reach(outsider, child.id, child.token)).toEqual(hidden);
	});

	test("a page with a read restriction and no children can be trashed", async () => {
		const parent = await mk("Lonely board pack");
		await restrict(parent.id, { userIds: [editor.id, alice.id] });
		const trashed = await editor.post(`/api/wiki/pages/${parent.id}/trash`);
		expect(trashed.status).toBe(200);
	});

	test("someone who may change restrictions trashes it; restore puts the children back", async () => {
		const parent = await mk("Trashed board pack");
		await restrict(parent.id, { userIds: [restricter.id, alice.id] });
		const first = await mk("Trashed first", parent.id);
		const second = await mk("Trashed second", parent.id);
		const grandchild = await mk("Trashed grandchild", second.id);
		const trashed = await restricter.post(`/api/wiki/pages/${parent.id}/trash`);
		expect(trashed.status).toBe(200);
		const children = await rows<{ id: string; parent_id: string | null }>(
			"select id, parent_id from pages where id = any($1)",
			[[first.id, second.id]],
		);
		expect(children.map((row) => row.parent_id)).toEqual([
			space.homeId,
			space.homeId,
		]);

		const restored = await restricter.post(
			`/api/wiki/pages/${parent.id}/restore`,
		);
		expect(restored.status).toBe(200);
		const back = await rows<{ id: string; parent_id: string }>(
			"select id, parent_id from pages where id = any($1) order by position",
			[[first.id, second.id]],
		);
		expect(back.map((row) => [row.id, row.parent_id])).toEqual([
			[first.id, parent.id],
			[second.id, parent.id],
		]);
		for (const page of [first, second, grandchild]) {
			expect(await reach(outsider, page.id, page.token)).toEqual(hidden);
		}
		expect(
			await rows("select 1 from page_trash where page_id = $1", [parent.id]),
		).toHaveLength(0);
	});

	test("trashing a page that is only restricted from above keeps its children restricted", async () => {
		const { top, leaf, grandchild } = await restrictedBranch();
		expect(top.id).not.toBe(leaf.id);
		const trashed = await editor.post(`/api/wiki/pages/${leaf.id}/trash`);
		expect(trashed.status).toBe(200);
		expect(await reach(outsider, grandchild.id, grandchild.token)).toEqual(
			hidden,
		);
		const restored = await editor.post(`/api/wiki/pages/${leaf.id}/restore`);
		expect(restored.status).toBe(200);
		const [row] = await rows("select parent_id from pages where id = $1", [
			grandchild.id,
		]);
		expect(row.parent_id).toBe(leaf.id);
		expect(await reach(outsider, grandchild.id, grandchild.token)).toEqual(
			hidden,
		);
	});

	test("restore leaves a child where it was moved after the trash", async () => {
		const parent = await mk("Moved after trash");
		const kept = await mk("Moved child", parent.id);
		const away = await mk("Moved away", parent.id);
		const elsewhere = await mk("Moved elsewhere");
		await editor.post(`/api/wiki/pages/${parent.id}/trash`);
		await editor.post(`/api/wiki/pages/${away.id}/move`, {
			parentId: elsewhere.id,
		});
		await editor.post(`/api/wiki/pages/${parent.id}/restore`);
		const parents = await rows<{ id: string; parent_id: string }>(
			"select id, parent_id from pages where id = any($1)",
			[[kept.id, away.id]],
		);
		expect(new Map(parents.map((row) => [row.id, row.parent_id]))).toEqual(
			new Map([
				[kept.id, parent.id],
				[away.id, elsewhere.id],
			]),
		);
	});

	test("restoring to the space root keeps the restriction of the page it sat under", async () => {
		const top = await mk("Restore top");
		await restrict(top.id, { userIds: [editor.id, alice.id] });
		const middle = await mk("Restore middle", top.id);
		const leaf = await mk("Restore leaf", middle.id);
		expect((await editor.post(`/api/wiki/pages/${leaf.id}/trash`)).status).toBe(
			200,
		);
		expect(
			(await editor.post(`/api/wiki/pages/${middle.id}/trash`)).status,
		).toBe(200);
		const restored = await editor.post(`/api/wiki/pages/${leaf.id}/restore`);
		expect(restored.status).toBe(200);
		expect(restored.body.parentId).toBeNull();
		expect(await ownReaders(leaf.id)).toEqual([editor.id, alice.id].sort());
		expect(await reach(outsider, leaf.id, leaf.token)).toEqual(hidden);
	});
});
