import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	doc,
	pageLinkDoc,
	rows,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let author: Client;
let reader: Client;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("P");
	author = await wiki.user("author");
	reader = await wiki.user("reader");
	await wiki.grant(space.id, { userId: author.id }, [
		"read",
		"create",
		"delete",
	]);
	await wiki.grant(space.id, { userId: reader.id }, ["read"]);
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

const versions = (pageId: string) =>
	rows<{
		number: number;
		title: string;
		message: string | null;
		minor_edit: boolean;
		body_doc: unknown;
	}>(
		"select number, title, message, minor_edit, body_doc from page_versions where page_id = $1 order by number",
		[pageId],
	);

describe("create", () => {
	test("a new space has a home page with a version row and creator permissions", async () => {
		const [row] = await rows(
			"select s.type, s.status, p.title, p.version_number, p.status as page_status from spaces s join pages p on p.id = s.home_page_id where s.id = $1",
			[space.id],
		);
		expect(row).toMatchObject({
			type: "global",
			status: "current",
			title: `Space ${space.key}`,
			version_number: 1,
			page_status: "current",
		});
		expect((await versions(space.homeId)).map((v) => v.number)).toEqual([1]);
		const permissions = await rows(
			"select permission from space_permissions where space_id = $1 and user_id = $2",
			[space.id, wiki.admin.id],
		);
		expect(permissions.map((p) => p.permission).sort()).toEqual([
			"administer",
			"create",
			"delete",
			"export",
			"read",
			"restrict",
		]);
	});

	test("stores body_doc and generates html and storage, with a first version", async () => {
		const created = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			parentId: space.homeId,
			title: "Created page",
			bodyDoc: doc("Hello creator"),
			labels: ["Alpha", " beta "],
			message: "first",
		});
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			spaceKey: space.key,
			title: "Created page",
			parentId: space.homeId,
			status: "current",
			version: 1,
		});
		const [page] = await rows(
			"select body_doc, body_html, body_storage, creator_id, last_modifier_id from pages where id = $1",
			[created.body.id],
		);
		expect(page.body_doc.type).toBe("doc");
		expect(page.body_html).toContain("Hello creator");
		expect(page.body_storage).toContain("Hello creator");
		expect(page.creator_id).toBe(author.id);
		const labels = await rows(
			"select label from page_labels where page_id = $1 order by label",
			[created.body.id],
		);
		expect(labels.map((l) => l.label)).toEqual(["alpha", "beta"]);
		const list = await versions(created.body.id);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			number: 1,
			title: "Created page",
			message: "first",
		});
	});

	test("a page created without a parent goes under the space home page", async () => {
		const created = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "No parent given",
			bodyDoc: doc("Hello"),
		});
		expect(created.status).toBe(201);
		expect(created.body.parentId).toBe(space.homeId);
		const [row] = await rows("select parent_id from pages where id = $1", [
			created.body.id,
		]);
		expect(row.parent_id).toBe(space.homeId);
	});

	test("appends to the sibling order", async () => {
		const a = await wiki.page(author, space.key, "Order A", {
			parentId: space.homeId,
		});
		const b = await wiki.page(author, space.key, "Order B", {
			parentId: space.homeId,
		});
		const [pa, pb] = await rows<{ position: number }>(
			"select position from pages where id in ($1, $2) order by title",
			[a.id, b.id],
		);
		expect(pb.position).toBeGreaterThan(pa.position);
	});

	test("rejects invalid documents, unknown spaces and anonymous callers", async () => {
		const bad = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Bad doc",
			bodyDoc: { type: "doc", content: [{ type: "nonsense" }] },
		});
		expect(bad.status).toBe(400);
		expect(bad.body.error).toMatch(/unknown node type/);
		const noSpace = await author.post("/api/wiki/pages", {
			spaceKey: "NOPE0000",
			title: "x",
			bodyDoc: doc("x"),
		});
		expect(noSpace.status).toBe(404);
		const anonymous = await wiki.app.inject({
			method: "POST",
			url: "/api/wiki/pages",
			payload: {},
		});
		expect(anonymous.statusCode).toBe(401);
		const missing = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
		});
		expect(missing.status).toBe(400);
	});

	test("accepts documents over one megabyte and reports bad ids as 400", async () => {
		const big = doc(...Array.from({ length: 40 }, () => "x".repeat(50_000)));
		expect(JSON.stringify(big).length).toBeGreaterThan(1_048_576);
		const created = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Big page",
			bodyDoc: big,
		});
		expect(created.status).toBe(201);
		const bad = await author.put("/api/wiki/pages/not-a-uuid", {
			bodyDoc: doc("x"),
		});
		expect(bad.status).toBe(400);
		expect(bad.body).toHaveProperty("error");
	});

	test("a reader without create permission is refused", async () => {
		const denied = await reader.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Not allowed",
			bodyDoc: doc("x"),
		});
		expect(denied.status).toBe(403);
	});
});

describe("title uniqueness", () => {
	test("is enforced per space among current pages", async () => {
		await wiki.page(author, space.key, "Unique title");
		const again = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Unique title",
			bodyDoc: doc("x"),
		});
		expect(again.status).toBe(409);

		const other = await wiki.space("Q");
		const elsewhere = await wiki.admin.post("/api/wiki/pages", {
			spaceKey: other.key,
			title: "Unique title",
			bodyDoc: doc("x"),
		});
		expect(elsewhere.status).toBe(201);
	});

	test("update and rename onto a taken title are refused", async () => {
		await wiki.page(author, space.key, "Taken one");
		const other = await wiki.page(author, space.key, "Taken two");
		const renamed = await author.post(`/api/wiki/pages/${other.id}/rename`, {
			title: "Taken one",
		});
		expect(renamed.status).toBe(409);
		const updated = await author.put(`/api/wiki/pages/${other.id}`, {
			title: "Taken one",
			bodyDoc: doc("y"),
		});
		expect(updated.status).toBe(409);
	});

	test("a trashed page releases its title", async () => {
		const page = await wiki.page(author, space.key, "Reusable title");
		expect((await author.post(`/api/wiki/pages/${page.id}/trash`)).status).toBe(
			200,
		);
		await wiki.page(author, space.key, "Reusable title");
		const restore = await author.post(`/api/wiki/pages/${page.id}/restore`);
		expect(restore.status).toBe(409);
	});
});

describe("update and versions", () => {
	test("every publish adds a version row; baseVersion mismatch is a 409", async () => {
		const page = await wiki.page(author, space.key, "Versioned");
		const second = await author.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: doc("second body"),
			baseVersion: 1,
			message: "edit two",
			minorEdit: true,
		});
		expect(second.status).toBe(200);
		expect(second.body.version).toBe(2);

		const stale = await author.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: doc("stale"),
			baseVersion: 1,
		});
		expect(stale.status).toBe(409);
		expect(stale.body.currentVersion).toBe(2);

		const third = await author.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: doc("third body"),
			baseVersion: 2,
		});
		expect(third.body.version).toBe(3);
		const list = await versions(page.id);
		expect(list.map((v) => v.number)).toEqual([1, 2, 3]);
		expect(list[1]).toMatchObject({ message: "edit two", minor_edit: true });
		const [current] = await rows(
			"select body_html, last_modifier_id, updated from pages where id = $1",
			[page.id],
		);
		expect(current.body_html).toContain("third body");
		expect(current.updated).not.toBeNull();
	});

	test("an imported-style page without version rows is snapshotted first", async () => {
		const [created] = await rows<{ id: string }>(
			`insert into pages (source_id, space_id, title, status, version_number, body_storage, body_html, creator_id, created)
			 values ($1, $2, 'Legacy page', 'current', 3, '<p>legacy storage</p>', '<p>legacy html</p>', $3, now()) returning id`,
			[`fat:test-${randomUUID()}`, space.id, author.id],
		);
		await pool.query(
			"insert into page_versions (source_id, page_id, number, title, body_html) values ($1, $2, 1, 'Legacy page', '<p>v1</p>')",
			[`fat:test-${randomUUID()}`, created.id],
		);
		const updated = await author.put(`/api/wiki/pages/${created.id}`, {
			bodyDoc: doc("modern body"),
			baseVersion: 3,
		});
		expect(updated.body.version).toBe(4);
		const list = await rows<{ number: number; body_html: string }>(
			"select number, body_html from page_versions where page_id = $1 order by number",
			[created.id],
		);
		expect(list.map((v) => v.number)).toEqual([1, 3, 4]);
		expect(list[1].body_html).toBe("<p>legacy html</p>");
		expect(list[2].body_html).toContain("modern body");
	});

	test("a changed title is applied with the new version", async () => {
		const page = await wiki.page(author, space.key, "Before retitle");
		const updated = await author.put(`/api/wiki/pages/${page.id}`, {
			title: "After retitle",
			bodyDoc: doc("same"),
		});
		expect(updated.body.title).toBe("After retitle");
		const list = await versions(page.id);
		expect(list[1].title).toBe("After retitle");
	});

	test("readers cannot publish; trashed pages cannot be updated", async () => {
		const page = await wiki.page(author, space.key, "Guarded");
		const denied = await reader.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: doc("no"),
		});
		expect(denied.status).toBe(403);
		await author.post(`/api/wiki/pages/${page.id}/trash`);
		const trashed = await author.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: doc("no"),
		});
		expect(trashed.status).toBe(409);
	});

	test("links to existing pages get their href, unknown ones the create fallback", async () => {
		const target = await wiki.page(author, space.key, "Link target");
		const page = await wiki.page(author, space.key, "Linker", {
			bodyDoc: pageLinkDoc("Link target"),
		});
		const [row] = await rows("select body_html from pages where id = $1", [
			page.id,
		]);
		expect(row.body_html).toContain(
			`/pages/viewpage.action?pageId=${target.id}`,
		);

		const dangling = await author.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: pageLinkDoc("Not written yet"),
		});
		expect(dangling.status).toBe(200);
		const [after] = await rows("select body_html from pages where id = $1", [
			page.id,
		]);
		expect(after.body_html).toContain("createpage.action");
	});
});

describe("restore version and rename", () => {
	test("restoring creates a new version with the old body", async () => {
		const page = await wiki.page(author, space.key, "Restorable");
		await author.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: doc("changed body"),
		});
		const restored = await author.post(
			`/api/wiki/pages/${page.id}/restore-version`,
			{ version: 1 },
		);
		expect(restored.status).toBe(200);
		expect(restored.body.version).toBe(3);
		const list = await versions(page.id);
		expect(list.map((v) => v.number)).toEqual([1, 2, 3]);
		expect(list[2].message).toBe("Restored version 1");
		const [row] = await rows("select body_html from pages where id = $1", [
			page.id,
		]);
		expect(row.body_html).toContain("Body of Restorable");
		expect(row.body_html).not.toContain("changed body");

		const missing = await author.post(
			`/api/wiki/pages/${page.id}/restore-version`,
			{ version: 9 },
		);
		expect(missing.status).toBe(404);
	});

	test("rename adds a version with the same body", async () => {
		const page = await wiki.page(author, space.key, "Old name");
		const renamed = await author.post(`/api/wiki/pages/${page.id}/rename`, {
			title: "New name",
		});
		expect(renamed.status).toBe(200);
		expect(renamed.body).toMatchObject({ title: "New name", version: 2 });
		const list = await versions(page.id);
		expect(list.map((v) => [v.number, v.title])).toEqual([
			[1, "Old name"],
			[2, "New name"],
		]);
		const [row] = await rows("select body_html from pages where id = $1", [
			page.id,
		]);
		expect(row.body_html).toContain("Body of Old name");
	});
});

describe("drafts of unpublished pages", () => {
	test("publishing a draft page turns it current with version 1", async () => {
		const created = await author.post("/api/wiki/pages/drafts", {
			spaceKey: space.key,
			parentId: space.homeId,
		});
		expect(created.status).toBe(201);
		const { pageId } = created.body;
		const [draftRow] = await rows(
			"select status, version_number from pages where id = $1",
			[pageId],
		);
		expect(draftRow).toMatchObject({ status: "draft", version_number: 0 });

		const published = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			parentId: space.homeId,
			title: "From draft",
			bodyDoc: doc("drafted"),
			draftPageId: pageId,
		});
		expect(published.status).toBe(201);
		expect(published.body).toMatchObject({
			id: pageId,
			status: "current",
			version: 1,
		});
		expect((await versions(pageId)).map((v) => v.number)).toEqual([1]);
		expect(
			await rows("select id from page_drafts where page_id = $1", [pageId]),
		).toHaveLength(0);
	});

	test("another user cannot publish someone else's draft page", async () => {
		const created = await author.post("/api/wiki/pages/drafts", {
			spaceKey: space.key,
		});
		const other = await wiki.user("otherauthor");
		await wiki.grant(space.id, { userId: other.id }, ["read", "create"]);
		const stolen = await other.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Stolen",
			bodyDoc: doc("x"),
			draftPageId: created.body.pageId,
		});
		expect(stolen.status).toBe(404);
	});
});

describe("labels", () => {
	test("set replaces the label list", async () => {
		const page = await wiki.page(author, space.key, "Labelled", {
			labels: ["one", "two"],
		});
		const set = await author.put(`/api/wiki/pages/${page.id}/labels`, {
			labels: ["two", "Three"],
		});
		expect(set.status).toBe(200);
		expect(set.body.labels).toEqual(["three", "two"]);
		const denied = await reader.put(`/api/wiki/pages/${page.id}/labels`, {
			labels: [],
		});
		expect(denied.status).toBe(403);
	});
});
