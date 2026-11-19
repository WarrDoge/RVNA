import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { multipart, setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("CMB");
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

const macro = (
	name: string,
	options: {
		params?: { name: string; value: string }[];
		bodyType?: "rich" | "plain" | null;
		body?: string | null;
		content?: unknown[];
	} = {},
) => ({
	type: "macro",
	attrs: {
		name,
		params: options.params ?? [],
		bodyType: options.bodyType ?? null,
		body: options.body ?? null,
		macroId: null,
		schemaVersion: null,
	},
	content: options.content ?? [],
});

const paragraph = (text: string) => ({
	type: "paragraph",
	content: [{ type: "text", text }],
});

const macroDoc = {
	type: "doc" as const,
	content: [
		{
			type: "heading",
			attrs: { level: 2 },
			content: [{ type: "text", text: "Combined heading" }],
		},
		macro("toc"),
		macro("info", {
			params: [{ name: "title", value: "Heads up" }],
			bodyType: "rich",
			content: [paragraph("info panel text")],
		}),
		macro("code", {
			params: [{ name: "language", value: "js" }],
			bodyType: "plain",
			body: "const combined = 1;",
		}),
	],
};

describe("pages written by the editor are rendered by the reading screens", () => {
	test("toc, info and code macros render instead of placeholders", async () => {
		const created = await wiki.admin.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Macro page",
			bodyDoc: macroDoc,
		});
		expect(created.status).toBe(201);

		const read = await wiki.admin.get(`/api/wiki/pages/${created.body.id}`);
		expect(read.status).toBe(200);
		const html: string = read.body.bodyHtml;
		expect(html).toContain("Combined heading");
		expect(html).toContain("info panel text");
		expect(html).toContain("Heads up");
		expect(html).toContain("const combined = 1;");
		expect(html).toMatch(/wiki-toc/);
		expect(html).not.toContain('class="wiki-macro ');
		expect(html).not.toMatch(/wiki-unknown-macro/);
		expect(html).not.toContain("<script");
	});

	test("a publish shows up in recently updated and in the macro", async () => {
		const page = await wiki.page(wiki.admin, space.key, "Fresh page");
		const recent = await wiki.admin.get(
			`/api/wiki/recent?space=${space.key}&limit=5`,
		);
		expect(recent.body.map((row: { id: string }) => row.id)).toContain(page.id);

		const host = await wiki.admin.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Recent host",
			bodyDoc: {
				type: "doc",
				content: [
					macro("recently-updated", {
						params: [{ name: "spaces", value: space.key }],
					}),
				],
			},
		});
		const updated = await wiki.admin.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: {
				type: "doc",
				content: [paragraph("edited again")],
			},
		});
		expect(updated.status).toBe(200);
		const read = await wiki.admin.get(`/api/wiki/pages/${host.body.id}`);
		expect(read.body.bodyHtml).toContain("Fresh page");
		const after = await wiki.admin.get(
			`/api/wiki/recent?space=${space.key}&limit=1`,
		);
		expect(after.body[0].id).toBe(page.id);
	});

	test("the editor context opens by the source id the Confluence URLs carry", async () => {
		const page = await wiki.page(wiki.admin, space.key, "Source id page");
		const [row] = (
			await pool.query<{ source_id: string }>(
				"select source_id from pages where id = $1",
				[page.id],
			)
		).rows;
		const context = await wiki.admin.get(
			`/api/wiki/edit/pages/${row?.source_id}`,
		);
		expect(context.status).toBe(200);
		expect(context.body.page.id).toBe(page.id);
		expect(
			(await wiki.admin.get("/api/wiki/edit/pages/no-such-page")).status,
		).toBe(404);
	});

	test("a draft is visible to its creator only and a trashed page to nobody", async () => {
		const other = await wiki.user("other");
		await wiki.grant(space.id, { userId: other.id }, ["read", "create"]);
		const draft = await wiki.admin.post("/api/wiki/pages/drafts", {
			spaceKey: space.key,
		});
		expect(draft.status).toBe(201);
		const draftId = draft.body.pageId ?? draft.body.id;
		expect((await wiki.admin.get(`/api/wiki/pages/${draftId}`)).status).toBe(
			200,
		);
		expect((await other.get(`/api/wiki/pages/${draftId}`)).status).toBe(404);

		const page = await wiki.page(wiki.admin, space.key, "To trash");
		expect((await other.get(`/api/wiki/pages/${page.id}`)).status).toBe(200);
		await wiki.admin.post(`/api/wiki/pages/${page.id}/trash`);
		expect((await other.get(`/api/wiki/pages/${page.id}`)).status).toBe(404);
		expect((await wiki.admin.get(`/api/wiki/pages/${page.id}`)).status).toBe(
			404,
		);
	});

	test("restoring a version through the editor route shows in the history", async () => {
		const page = await wiki.page(wiki.admin, space.key, "History page");
		await wiki.admin.put(`/api/wiki/pages/${page.id}`, {
			bodyDoc: { type: "doc", content: [paragraph("second body")] },
		});
		const restored = await wiki.admin.post(
			`/api/wiki/pages/${page.id}/restore-version`,
			{ version: 1 },
		);
		expect(restored.status).toBe(200);
		const versions = await wiki.admin.get(
			`/api/wiki/pages/${page.id}/versions`,
		);
		expect(versions.body.map((row: { number: number }) => row.number)).toEqual(
			expect.arrayContaining([1, 2, 3]),
		);
	});
});

describe("attachments", () => {
	test("deleting the original keeps the file a copied page still uses", async () => {
		const page = await wiki.page(wiki.admin, space.key, "Attachment source");
		const file = multipart({
			name: "shared.txt",
			type: "text/plain",
			content: "shared bytes",
		});
		const uploaded = await wiki.admin.raw(
			"POST",
			`/api/wiki/pages/${page.id}/attachments`,
			file.payload,
			file.contentType,
		);
		expect(uploaded.status).toBe(201);
		const original = uploaded.body[0].id as string;

		const copy = await wiki.admin.post(`/api/wiki/pages/${page.id}/copy`, {
			title: "Attachment copy",
			withAttachments: true,
		});
		expect(copy.status).toBe(201);
		const copiedRows = await pool.query<{ id: string; storage_path: string }>(
			"select id, storage_path from page_attachments where page_id = $1",
			[copy.body.id],
		);
		expect(copiedRows.rows).toHaveLength(1);
		const copied = copiedRows.rows[0] as { id: string; storage_path: string };
		const [source] = (
			await pool.query<{ storage_path: string }>(
				"select storage_path from page_attachments where id = $1",
				[original],
			)
		).rows;
		expect(copied.storage_path).toBe(source?.storage_path);

		const removed = await wiki.admin.del(`/api/wiki/attachments/${original}`);
		expect(removed.status).toBe(204);

		const response = await wiki.app.inject({
			method: "GET",
			url: `/api/wiki/attachments/${copied.id}`,
			cookies: { sid: wiki.admin.session },
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).toBe("shared bytes");

		await wiki.admin.del(`/api/wiki/attachments/${copied.id}`);
		const gone = await wiki.app.inject({
			method: "GET",
			url: `/api/wiki/attachments/${copied.id}`,
			cookies: { sid: wiki.admin.session },
		});
		expect(gone.statusCode).toBe(404);
	});
});
