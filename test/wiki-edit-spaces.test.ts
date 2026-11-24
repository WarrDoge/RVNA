import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool } from "../src/lib/server/db.ts";
import { pageAttachments } from "../src/lib/server/schema-wiki.ts";
import {
	type Client,
	doc,
	multipart,
	rows,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let editor: Client;
let reader: Client;
let group: string;

beforeAll(async () => {
	wiki = await setupWiki();
	group = `t-${wiki.run}-sp`;
	space = await wiki.space("E");
	editor = await wiki.user("editor");
	reader = await wiki.user("reader", [group]);
	await wiki.grant(space.id, { userId: editor.id }, ["read", "create"]);
	await wiki.grant(space.id, { userId: reader.id }, ["read"]);
});

afterAll(async () => {
	await pool.query("delete from page_templates where source_id like $1", [
		`fat:test-${wiki.run}%`,
	]);
	await wiki.cleanup();
	await pool.end();
});

async function waitForLockWaiters(count: number) {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const result = await pool.query<{ n: number }>(
			`select count(*)::int as n from pg_stat_activity
			 where datname = current_database() and wait_event_type = 'Lock'`,
		);
		if ((result.rows[0]?.n ?? 0) >= count) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`timed out waiting for ${count} lock waiters`);
}

const fileExists = (path: string) =>
	access(join(process.env.ATTACHMENTS_DIR as string, path)).then(
		() => true,
		() => false,
	);

describe("space lifecycle", () => {
	test("only an app admin creates a space; keys are validated and unique", async () => {
		const key = `T${wiki.run.toUpperCase()}K1`;
		const denied = await editor.post("/api/wiki/spaces", {
			key,
			name: "Denied",
		});
		expect(denied.status).toBe(403);
		for (const bad of ["A", "has space", "bad-key", "x".repeat(256)]) {
			const response = await wiki.admin.post("/api/wiki/spaces", {
				key: bad,
				name: "Bad",
			});
			expect(response.status).toBe(400);
		}
		const created = await wiki.admin.post("/api/wiki/spaces", {
			key: key.toLowerCase(),
			name: "Key one",
			description: "A <b>plain</b> text",
		});
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			key,
			name: "Key one",
			type: "global",
			status: "current",
			descriptionHtml: "<p>A &lt;b&gt;plain&lt;/b&gt; text</p>",
		});
		expect(created.body.homePageId).toEqual(expect.any(String));
		const [owner] = await rows(
			"select owner_id, creator_id from spaces where key = $1",
			[key],
		);
		expect(owner).toEqual({
			owner_id: wiki.admin.id,
			creator_id: wiki.admin.id,
		});
		const again = await wiki.admin.post("/api/wiki/spaces", {
			key,
			name: "Again",
		});
		expect(again.status).toBe(409);
	});

	test("space admins edit details and archive; others cannot", async () => {
		const own = await wiki.space("D");
		const admin = await wiki.user("spaceadmin");
		await wiki.grant(own.id, { userId: admin.id }, ["administer"]);
		await wiki.grant(own.id, { userId: editor.id }, ["read", "create"]);

		expect(
			(await editor.put(`/api/wiki/spaces/${own.key}`, { name: "Nope" }))
				.status,
		).toBe(403);
		const updated = await admin.put(`/api/wiki/spaces/${own.key}`, {
			name: "Renamed space",
			description: "New text",
		});
		expect(updated.body).toMatchObject({
			name: "Renamed space",
			descriptionHtml: "<p>New text</p>",
		});

		const page = await wiki.page(admin, own.key, "New home");
		const home = await admin.put(`/api/wiki/spaces/${own.key}`, {
			homePageId: page.id,
		});
		expect(home.body.homePageId).toBe(page.id);
		const foreign = await admin.put(`/api/wiki/spaces/${own.key}`, {
			homePageId: space.homeId,
		});
		expect(foreign.status).toBe(400);

		expect(
			(await editor.post(`/api/wiki/spaces/${own.key}/archive`)).status,
		).toBe(403);
		const archived = await admin.post(`/api/wiki/spaces/${own.key}/archive`);
		expect(archived.body.status).toBe("archived");
		const listed = await editor.get("/api/wiki/edit/spaces");
		expect(listed.body.map((s: { key: string }) => s.key)).not.toContain(
			own.key,
		);
		const restored = await admin.post(`/api/wiki/spaces/${own.key}/unarchive`);
		expect(restored.body.status).toBe("current");
		const back = await editor.get("/api/wiki/edit/spaces");
		expect(
			back.body.find((s: { key: string }) => s.key === own.key),
		).toMatchObject({ canCreate: true });
	});

	test("deleting needs an app admin and removes pages, rows and files", async () => {
		const own = await wiki.space("X");
		const admin = await wiki.user("spaceadmin2");
		await wiki.grant(own.id, { userId: admin.id }, ["administer"]);
		const page = await wiki.page(wiki.admin, own.key, "Doomed");
		const upload = multipart({
			name: "doomed.txt",
			type: "text/plain",
			content: `doomed ${randomUUID()}`,
		});
		const uploaded = await wiki.admin.raw(
			"POST",
			`/api/wiki/pages/${page.id}/attachments`,
			upload.payload,
			upload.contentType,
		);
		const [stored] = await rows(
			"select storage_path from page_attachments where id = $1",
			[uploaded.body[0].id],
		);
		expect(await fileExists(stored.storage_path)).toBe(true);

		expect((await admin.del(`/api/wiki/spaces/${own.key}`)).status).toBe(403);
		expect((await wiki.admin.del(`/api/wiki/spaces/${own.key}`)).status).toBe(
			204,
		);
		expect(
			await rows("select 1 from pages where space_id = $1", [own.id]),
		).toHaveLength(0);
		expect(
			await rows("select 1 from page_attachments where id = $1", [
				uploaded.body[0].id,
			]),
		).toHaveLength(0);
		expect(await fileExists(stored.storage_path)).toBe(false);
		expect((await wiki.admin.del(`/api/wiki/spaces/${own.key}`)).status).toBe(
			404,
		);
	});
});

describe("concurrent deletes", () => {
	test("an update that loses its space answers 404", async () => {
		const own = await wiki.space("GD");
		const locker = await pool.connect();
		try {
			await locker.query("begin");
			await locker.query("delete from spaces where id = $1", [own.id]);
			const request = wiki.admin.put(`/api/wiki/spaces/${own.key}`, {
				name: "Too late",
			});
			await waitForLockWaiters(1);
			await locker.query("commit");
			expect((await request).status).toBe(404);
		} finally {
			await locker.query("rollback").catch(() => undefined);
			locker.release();
		}
	});

	test("an archive that loses its space answers 404", async () => {
		const own = await wiki.space("GS");
		const locker = await pool.connect();
		try {
			await locker.query("begin");
			await locker.query("delete from spaces where id = $1", [own.id]);
			const request = wiki.admin.post(`/api/wiki/spaces/${own.key}/archive`);
			await waitForLockWaiters(1);
			await locker.query("commit");
			expect((await request).status).toBe(404);
		} finally {
			await locker.query("rollback").catch(() => undefined);
			locker.release();
		}
	});

	test("a template edit that loses its template answers 404", async () => {
		const own = await wiki.space("GT");
		const created = await wiki.admin.post(
			`/api/wiki/spaces/${own.key}/templates`,
			{ name: "Doomed template", bodyDoc: doc("body") },
		);
		expect(created.status).toBe(201);
		const locker = await pool.connect();
		try {
			await locker.query("begin");
			await locker.query("delete from page_templates where id = $1", [
				created.body.id,
			]);
			const request = wiki.admin.put(`/api/wiki/templates/${created.body.id}`, {
				name: "Too late",
				bodyDoc: doc("changed"),
			});
			await waitForLockWaiters(1);
			await locker.query("commit");
			expect((await request).status).toBe(404);
		} finally {
			await locker.query("rollback").catch(() => undefined);
			locker.release();
		}
	});
});

describe("templates", () => {
	test("space admins manage templates, readers list and open them", async () => {
		const own = await wiki.space("TP");
		const admin = await wiki.user("tmpladmin");
		await wiki.grant(own.id, { userId: admin.id }, ["administer"]);
		await wiki.grant(own.id, { userId: reader.id }, ["read"]);
		const body = {
			name: "Meeting notes",
			description: "Agenda",
			bodyDoc: doc("Agenda items"),
		};

		expect(
			(await reader.post(`/api/wiki/spaces/${own.key}/templates`, body)).status,
		).toBe(403);
		const created = await admin.post(
			`/api/wiki/spaces/${own.key}/templates`,
			body,
		);
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			spaceKey: own.key,
			name: "Meeting notes",
			description: "Agenda",
		});
		expect(created.body.bodyDoc.type).toBe("doc");

		await pool.query(
			"insert into page_templates (source_id, space_id, name) values ($1, null, $2)",
			[`fat:test-${wiki.run}-global`, `Global ${wiki.run}`],
		);
		const listed = await reader.get(
			`/api/wiki/edit/spaces/${own.key}/templates`,
		);
		expect(listed.status).toBe(200);
		const names = listed.body.map((t: { name: string }) => t.name);
		expect(names).toContain("Meeting notes");
		expect(names).toContain(`Global ${wiki.run}`);
		expect(
			listed.body.find((t: { name: string }) => t.name === `Global ${wiki.run}`)
				.spaceKey,
		).toBeNull();

		const detail = await reader.get(
			`/api/wiki/edit/templates/${created.body.id}`,
		);
		expect(JSON.stringify(detail.body.bodyDoc)).toContain("Agenda items");

		expect(
			(await reader.put(`/api/wiki/templates/${created.body.id}`, body)).status,
		).toBe(403);
		const edited = await admin.put(`/api/wiki/templates/${created.body.id}`, {
			...body,
			name: "Meeting minutes",
			bodyDoc: doc("Minutes"),
		});
		expect(edited.body.name).toBe("Meeting minutes");
		expect(JSON.stringify(edited.body.bodyDoc)).toContain("Minutes");

		expect(
			(await reader.del(`/api/wiki/templates/${created.body.id}`)).status,
		).toBe(403);
		expect(
			(await admin.del(`/api/wiki/templates/${created.body.id}`)).status,
		).toBe(204);
		expect(
			(await admin.get(`/api/wiki/edit/templates/${created.body.id}`)).status,
		).toBe(404);
		const bad = await admin.post(`/api/wiki/spaces/${own.key}/templates`, {
			...body,
			bodyDoc: { type: "doc" },
		});
		expect(bad.status).toBe(400);
	});
});

describe("uploads", () => {
	test("stores files, returns urls and versions repeated names", async () => {
		const page = await wiki.page(editor, space.key, "Uploads page");
		const one = multipart({
			name: "report.txt",
			type: "text/plain",
			content: "first",
		});
		const first = await editor.raw(
			"POST",
			`/api/wiki/pages/${page.id}/attachments`,
			one.payload,
			one.contentType,
		);
		expect(first.status).toBe(201);
		expect(first.body[0]).toMatchObject({
			fileName: "report.txt",
			mimeType: "text/plain",
			size: 5,
		});
		expect(first.body[0].url).toBe(`/api/wiki/attachments/${first.body[0].id}`);
		const [row] = await rows(
			"select storage_path, sha256, version, author_id, source_id from page_attachments where id = $1",
			[first.body[0].id],
		);
		expect(row.version).toBe(1);
		expect(row.author_id).toBe(editor.id);
		expect(row.source_id).toMatch(/^local:/);
		expect(await fileExists(row.storage_path)).toBe(true);

		const two = multipart({
			name: "report.txt",
			type: "text/plain",
			content: "second!",
		});
		const second = await editor.raw(
			"POST",
			`/api/wiki/pages/${page.id}/attachments`,
			two.payload,
			two.contentType,
		);
		const [v2] = await rows(
			"select version from page_attachments where id = $1",
			[second.body[0].id],
		);
		expect(v2.version).toBe(2);

		const context = await editor.get(`/api/wiki/edit/pages/${page.id}`);
		expect(context.body.attachments).toEqual([
			{
				id: second.body[0].id,
				fileName: "report.txt",
				mimeType: "text/plain",
				size: 7,
				url: `/api/wiki/attachments/${second.body[0].id}`,
			},
		]);
	});

	test("a thumbnail download is private to the signed-in user", async () => {
		const page = await wiki.page(editor, space.key, "Thumbnail page");
		const image = multipart({
			name: "pixel.png",
			type: "image/png",
			content: "not really a picture",
		});
		const stored = await editor.raw(
			"POST",
			`/api/wiki/pages/${page.id}/attachments`,
			image.payload,
			image.contentType,
		);
		expect(stored.status).toBe(201);
		const response = await wiki.app.inject({
			method: "GET",
			url: `/download/thumbnails/${page.id}/pixel.png`,
			cookies: { sid: editor.session },
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe(
			"private, max-age=0, must-revalidate",
		);
	});

	test("stores an attachment size above the 32-bit range", async () => {
		const page = await wiki.page(editor, space.key, "Large attachment");
		const size = 2 ** 31 + 1;
		const [row] = await db
			.insert(pageAttachments)
			.values({
				sourceId: `fat:test-${randomUUID()}`,
				pageId: page.id,
				fileName: "large.bin",
				size,
				storagePath: "large/large.bin",
				sha256: "a".repeat(64),
			})
			.returning({ size: pageAttachments.size });
		expect(row?.size).toBe(size);
	});

	test("concurrent uploads of one file name get distinct versions", async () => {
		const page = await wiki.page(editor, space.key, "Attachment race");
		await pool.query(`
			create or replace function test_slow_attachment_insert() returns trigger
			language plpgsql as $$
			begin
				perform pg_advisory_xact_lock(987654321);
				return new;
			end $$`);
		await pool.query(
			"create trigger test_slow_attachment_insert before insert on page_attachments for each row execute function test_slow_attachment_insert()",
		);
		const locker = await pool.connect();
		try {
			await locker.query("begin");
			await locker.query("select pg_advisory_xact_lock(987654321)");
			const one = multipart({
				name: "race.txt",
				type: "text/plain",
				content: "first race",
			});
			const two = multipart({
				name: "race.txt",
				type: "text/plain",
				content: "second race",
			});
			const first = editor.raw(
				"POST",
				`/api/wiki/pages/${page.id}/attachments`,
				one.payload,
				one.contentType,
			);
			const second = editor.raw(
				"POST",
				`/api/wiki/pages/${page.id}/attachments`,
				two.payload,
				two.contentType,
			);
			await waitForLockWaiters(2);
			await locker.query("commit");
			const responses = await Promise.all([first, second]);
			expect(responses.map((response) => response.status).sort()).toEqual([
				201, 201,
			]);
			const stored = await rows<{ version: number }>(
				"select version from page_attachments where page_id = $1 and file_name = 'race.txt' order by version",
				[page.id],
			);
			expect(stored.map((row) => row.version)).toEqual([1, 2]);
		} finally {
			await locker.query("rollback").catch(() => undefined);
			locker.release();
			await pool.query(
				"drop trigger if exists test_slow_attachment_insert on page_attachments",
			);
			await pool.query("drop function if exists test_slow_attachment_insert()");
		}
	});

	test("refuses readers, non-multipart bodies and trashed pages", async () => {
		const page = await wiki.page(editor, space.key, "Uploads refused");
		const file = multipart({ name: "a.txt", type: "text/plain", content: "a" });
		expect(
			(
				await reader.raw(
					"POST",
					`/api/wiki/pages/${page.id}/attachments`,
					file.payload,
					file.contentType,
				)
			).status,
		).toBe(403);
		const json = await editor.raw(
			"POST",
			`/api/wiki/pages/${page.id}/attachments`,
			Buffer.from("{}"),
			"application/json",
		);
		expect(json.status).toBe(406);
		await wiki.admin.post(`/api/wiki/pages/${page.id}/trash`);
		expect(
			(
				await editor.raw(
					"POST",
					`/api/wiki/pages/${page.id}/attachments`,
					file.payload,
					file.contentType,
				)
			).status,
		).toBe(409);
	});

	test("an image of an unpublished page resolves to its attachment when published", async () => {
		const draft = await editor.post("/api/wiki/pages/drafts", {
			spaceKey: space.key,
		});
		const pageId = draft.body.pageId;
		const png = multipart({
			name: "pic.png",
			type: "image/png",
			content: "not really a png",
		});
		const uploaded = await editor.raw(
			"POST",
			`/api/wiki/pages/${pageId}/attachments`,
			png.payload,
			png.contentType,
		);
		const image = {
			type: "image",
			attrs: { src: null, fileName: "pic.png", alt: "pic" },
		};
		const published = await editor.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Page with image",
			bodyDoc: {
				type: "doc",
				content: [{ type: "paragraph", content: [image] }],
			},
			draftPageId: pageId,
		});
		expect(published.status).toBe(201);
		const [row] = await rows(
			"select body_html, body_doc from pages where id = $1",
			[pageId],
		);
		expect(row.body_html).toContain(
			`/api/wiki/attachments/${uploaded.body[0].id}`,
		);
		expect(JSON.stringify(row.body_doc)).toContain(uploaded.body[0].id);
	});
});

describe("editor support", () => {
	test("page search matches titles, honours the space filter and escapes wildcards", async () => {
		await wiki.page(editor, space.key, `Needle ${wiki.run} alpha`);
		await wiki.page(editor, space.key, `Needle ${wiki.run} 100% beta`);
		const hits = await editor.get(
			`/api/wiki/edit/page-search?q=Needle ${wiki.run}&spaceKey=${space.key}`,
		);
		expect(hits.body).toHaveLength(2);
		expect(hits.body[0]).toMatchObject({
			spaceKey: space.key,
			spaceName: `Space ${space.key}`,
		});
		const prefix = await editor.get(
			`/api/wiki/edit/page-search?q=Needle ${wiki.run} alp`,
		);
		expect(prefix.body.map((h: { title: string }) => h.title)).toEqual([
			`Needle ${wiki.run} alpha`,
		]);
		const wildcard = await editor.get(
			`/api/wiki/edit/page-search?q=${encodeURIComponent("%")}&spaceKey=${space.key}`,
		);
		expect(wildcard.body.map((h: { title: string }) => h.title)).toEqual([
			`Needle ${wiki.run} 100% beta`,
		]);
	});

	test("page search returns at most 20 hits", async () => {
		const many = await wiki.space("M");
		for (let i = 0; i < 22; i++)
			await wiki.page(wiki.admin, many.key, `Bulk ${wiki.run} ${i}`);
		const hits = await wiki.admin.get(
			`/api/wiki/edit/page-search?q=Bulk ${wiki.run}&spaceKey=${many.key}`,
		);
		expect(hits.body).toHaveLength(20);
	});

	test("restricted pages do not consume the search result budget", async () => {
		const own = await wiki.space("SR");
		await wiki.grant(own.id, { userId: editor.id }, ["read", "create"]);
		const prefix = `ZNeedle ${wiki.run}`;
		const hidden: string[] = [];
		for (let i = 0; i < 45; i++) {
			const page = await wiki.page(editor, own.key, `${prefix} A${i}`);
			hidden.push(page.id);
		}
		const visible: string[] = [];
		for (let i = 0; i < 20; i++) {
			const page = await wiki.page(editor, own.key, `${prefix} Z${i}`);
			visible.push(page.id);
		}
		await pool.query(
			`insert into page_restrictions (source_id, page_id, operation, user_id)
			 select $1 || ':' || id, id, 'read', $2 from unnest($3::uuid[]) as id`,
			[`fat:test-${wiki.run}-search`, wiki.admin.id, hidden],
		);
		const hits = await editor.get(
			`/api/wiki/edit/page-search?q=${encodeURIComponent(prefix)}&spaceKey=${own.key}`,
		);
		const hitIds = hits.body.map((hit: { id: string }) => hit.id).sort();
		expect(hitIds).toEqual([...visible].sort());
	});

	test("page search with an empty q lists recent pages without a database error", async () => {
		const hits = await wiki.admin.get("/api/wiki/edit/page-search?q=");
		expect(hits.status).toBe(200);
		expect(Array.isArray(hits.body)).toBe(true);
	});

	test("the space tree lists current pages with parent and position", async () => {
		const own = await wiki.space("TR");
		const parent = await wiki.page(wiki.admin, own.key, "Tree parent");
		const child = await wiki.page(wiki.admin, own.key, "Tree child", {
			parentId: parent.id,
		});
		const trashed = await wiki.page(wiki.admin, own.key, "Tree trashed");
		await wiki.admin.post(`/api/wiki/pages/${trashed.id}/trash`);
		const tree = await wiki.admin.get(`/api/wiki/edit/space-tree/${own.key}`);
		expect(tree.body.map((n: { title: string }) => n.title).sort()).toEqual(
			[`Space ${own.key}`, "Tree child", "Tree parent"].sort(),
		);
		expect(
			tree.body.find((n: { id: string }) => n.id === child.id),
		).toMatchObject({ parentId: parent.id, position: 0 });
		expect(
			(await wiki.admin.get("/api/wiki/edit/space-tree/NOSUCHSPACE")).status,
		).toBe(404);
	});

	test("group suggestions are the actor's groups, all groups for an admin", async () => {
		const other = `t-${wiki.run}-other`;
		await pool.query(
			"insert into groups (name) values ($1) on conflict (name) do nothing",
			[other],
		);
		await wiki.grant(space.id, { group: other }, ["read"]);

		const userHits = await reader.get(`/api/wiki/edit/groups?q=t-${wiki.run}`);
		expect(userHits.body).toContain(group);
		expect(userHits.body).not.toContain(other);

		const adminHits = await wiki.admin.get(
			`/api/wiki/edit/groups?q=t-${wiki.run}`,
		);
		expect(adminHits.body).toEqual(expect.arrayContaining([group, other]));

		const filtered = await reader.get(`/api/wiki/edit/groups?q=other`);
		expect(filtered.body).toEqual([]);
	});
});
