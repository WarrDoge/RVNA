import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	pageLinkDoc,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let open: TestSpace;
let hidden: TestSpace;
let member: Client;
let restrictedId: string;
let hiddenSpacePageId: string;
let openPageId: string;

beforeAll(async () => {
	wiki = await setupWiki();
	open = await wiki.space("O");
	hidden = await wiki.space("H");
	member = await wiki.user("member");
	await wiki.grant(open.id, { userId: member.id }, ["read", "create"]);
	restrictedId = (await wiki.page(wiki.admin, open.key, "Restricted memo")).id;
	const restricted = await wiki.admin.put(
		`/api/wiki/pages/${restrictedId}/restrictions`,
		{
			read: { userIds: [wiki.admin.id], groups: [] },
			update: { userIds: [], groups: [] },
		},
	);
	expect(restricted.status).toBe(200);
	hiddenSpacePageId = (await wiki.page(wiki.admin, hidden.key, "Far page")).id;
	openPageId = (await wiki.page(wiki.admin, open.key, "Open memo")).id;
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

describe("a page reference in a body resolves only to a page the author may read", () => {
	test("pages of an unreadable space or restricted away stay unresolved", async () => {
		const link = (title: string, spaceKey?: string) =>
			pageLinkDoc(title, spaceKey).content[0];
		const created = await member.post("/api/wiki/pages", {
			spaceKey: open.key,
			title: "Linking page",
			bodyDoc: {
				type: "doc",
				content: [
					link("Far page", hidden.key),
					link("Restricted memo"),
					link("Open memo"),
				],
			},
		});
		expect(created.status).toBe(201);
		const context = await member.get(`/api/wiki/edit/pages/${created.body.id}`);
		const stored = JSON.stringify(context.body.page.bodyDoc);
		expect(stored).not.toContain(hiddenSpacePageId);
		expect(stored).not.toContain(restrictedId);
		expect(stored).toContain(openPageId);
		const {
			rows: [row],
		} = await pool.query<{ body_html: string }>(
			"select body_html from pages where id = $1",
			[created.body.id],
		);
		expect(row.body_html).not.toContain(hiddenSpacePageId);
		expect(row.body_html).not.toContain(restrictedId);
		expect(row.body_html).toContain(openPageId);
	});

	test("an administrator still resolves every page", async () => {
		const created = await wiki.admin.post("/api/wiki/pages", {
			spaceKey: open.key,
			title: "Admin linking page",
			bodyDoc: {
				type: "doc",
				content: [
					pageLinkDoc("Far page", hidden.key).content[0],
					pageLinkDoc("Restricted memo").content[0],
				],
			},
		});
		expect(created.status).toBe(201);
		const context = await wiki.admin.get(
			`/api/wiki/edit/pages/${created.body.id}`,
		);
		const stored = JSON.stringify(context.body.page.bodyDoc);
		expect(stored).toContain(hiddenSpacePageId);
		expect(stored).toContain(restrictedId);
	});
});
