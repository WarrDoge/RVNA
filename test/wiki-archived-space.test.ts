import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { trashPermissions } from "../src/lib/server/wiki-edit/support.ts";
import {
	type Client,
	doc,
	multipart,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let other: TestSpace;
let editor: Client;
let spaceAdmin: Client;
let pageId: string;
let commentId: string;
let attachmentId: string;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("R");
	other = await wiki.space("S");
	editor = await wiki.user("editor");
	spaceAdmin = await wiki.user("spaceadmin");
	for (const s of [space, other]) {
		await wiki.grant(s.id, { userId: editor.id }, [
			"read",
			"create",
			"delete",
			"restrict",
		]);
	}
	await wiki.grant(space.id, { userId: spaceAdmin.id }, ["administer"]);

	pageId = (await wiki.page(editor, space.key, "Archived page")).id;
	const comment = await editor.post(`/api/wiki/pages/${pageId}/comments`, {
		bodyHtml: "<p>before the archive</p>",
		inline: true,
		marker: "m-1",
		selection: "Body",
	});
	expect(comment.status).toBe(201);
	commentId = comment.body.id;
	const upload = multipart({
		name: "before.txt",
		type: "text/plain",
		content: "x",
	});
	const file = await editor.raw(
		"POST",
		`/api/wiki/pages/${pageId}/attachments`,
		upload.payload,
		upload.contentType,
	);
	expect(file.status).toBe(201);
	attachmentId = file.body[0].id;

	const archived = await spaceAdmin.post(
		`/api/wiki/spaces/${space.key}/archive`,
	);
	expect(archived.body.status).toBe("archived");
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

describe("an archived space is read only", () => {
	test("the pages stay readable and say they cannot be edited", async () => {
		const context = await editor.get(`/api/wiki/edit/pages/${pageId}`);
		expect(context.status).toBe(200);
		expect(context.body.permissions).toEqual({
			canEdit: false,
			canRestrict: false,
			canDelete: false,
		});
		expect((await editor.get(`/api/wiki/pages/${pageId}`)).status).toBe(200);
		expect((await editor.get(`/api/wiki/edit/spaces`)).body).toEqual(
			expect.not.arrayContaining([expect.objectContaining({ key: space.key })]),
		);
	});

	test("page writes are refused", async () => {
		const mover = await wiki.page(editor, other.key, "Mover");
		const refusals: Record<string, () => Promise<{ status: number }>> = {
			create: () =>
				editor.post("/api/wiki/pages", {
					spaceKey: space.key,
					title: "New page",
					bodyDoc: doc("x"),
				}),
			"create a draft": () =>
				editor.post("/api/wiki/pages/drafts", { spaceKey: space.key }),
			update: () =>
				editor.put(`/api/wiki/pages/${pageId}`, { bodyDoc: doc("changed") }),
			rename: () =>
				editor.post(`/api/wiki/pages/${pageId}/rename`, { title: "Renamed" }),
			labels: () =>
				editor.put(`/api/wiki/pages/${pageId}/labels`, { labels: ["a"] }),
			"add a label": () =>
				editor.post(`/api/wiki/pages/${pageId}/labels`, { label: "b" }),
			"save a draft": () =>
				editor.put(`/api/wiki/pages/${pageId}/draft`, {
					title: "t",
					bodyDoc: doc("d"),
				}),
			lock: () => editor.post(`/api/wiki/pages/${pageId}/lock`),
			trash: () => editor.post(`/api/wiki/pages/${pageId}/trash`),
			restrict: () =>
				editor.put(`/api/wiki/pages/${pageId}/restrictions`, {
					read: { userIds: [], groups: [] },
					update: { userIds: [], groups: [] },
				}),
			"move out": () =>
				editor.post(`/api/wiki/pages/${pageId}/move`, { spaceKey: other.key }),
			"move in": () =>
				editor.post(`/api/wiki/pages/${mover.id}/move`, {
					spaceKey: space.key,
				}),
			"copy in": () =>
				editor.post(`/api/wiki/pages/${mover.id}/copy`, {
					title: "Copy",
					spaceKey: space.key,
				}),
		};
		for (const [name, request] of Object.entries(refusals)) {
			expect((await request()).status, name).toBe(403);
		}
	});

	test("comments and attachments are refused", async () => {
		const upload = multipart({
			name: "after.txt",
			type: "text/plain",
			content: "y",
		});
		const edit = await wiki.app.inject({
			method: "PATCH",
			url: `/api/wiki/comments/${commentId}`,
			cookies: { sid: editor.session },
			headers: { "x-requested-with": "rvna" },
			payload: { bodyHtml: "<p>edited</p>" },
		});
		const results = {
			comment: await editor.post(`/api/wiki/pages/${pageId}/comments`, {
				bodyHtml: "<p>after</p>",
			}),
			edit: { status: edit.statusCode },
			resolve: await editor.post(`/api/wiki/comments/${commentId}/resolve`, {
				resolved: true,
			}),
			remove: await editor.del(`/api/wiki/comments/${commentId}`),
			upload: await editor.raw(
				"POST",
				`/api/wiki/pages/${pageId}/attachments`,
				upload.payload,
				upload.contentType,
			),
			removeFile: await editor.del(`/api/wiki/attachments/${attachmentId}`),
		};
		for (const [name, reply] of Object.entries(results)) {
			expect(reply.status, name).toBe(403);
		}
	});

	test("the trash buttons are off, even for a space administrator", async () => {
		const actor = {
			id: spaceAdmin.id,
			username: spaceAdmin.username,
			displayName: spaceAdmin.username,
			email: null,
			avatarUrl: null,
			groups: [],
			isAdmin: false,
			mustChangePassword: false,
			hasPassword: false,
		};
		expect(await trashPermissions(actor, space.key)).toEqual({
			canRestore: false,
			canPurge: false,
		});
	});

	test("unarchiving makes the space writable again", async () => {
		const restored = await spaceAdmin.post(
			`/api/wiki/spaces/${space.key}/unarchive`,
		);
		expect(restored.body.status).toBe("current");
		expect(
			(
				await editor.put(`/api/wiki/pages/${pageId}`, {
					bodyDoc: doc("changed"),
				})
			).status,
		).toBe(200);
		expect(
			(
				await editor.post("/api/wiki/pages", {
					spaceKey: space.key,
					title: "New page",
					bodyDoc: doc("x"),
				})
			).status,
		).toBe(201);
	});
});
