import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	doc,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let open: TestSpace;
let hidden: TestSpace;
let member: Client;
let viewer: Client;
let outsider: Client;
let restrictedId: string;
let hiddenSpacePageId: string;
let openPageId: string;

const formHeaders = {
	origin: "http://127.0.0.1:3000",
	"content-type": "application/x-www-form-urlencoded",
};

beforeAll(async () => {
	wiki = await setupWiki();
	open = await wiki.space("O");
	hidden = await wiki.space("H");
	member = await wiki.user("member");
	viewer = await wiki.user("viewer");
	outsider = await wiki.user("outsider");
	await wiki.grant(open.id, { userId: member.id }, ["read", "create"]);
	await wiki.grant(open.id, { userId: viewer.id }, ["read"]);
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
	await pool.query("delete from page_templates where space_id = $1", [
		hidden.id,
	]);
	await wiki.cleanup();
	await pool.end();
});

const sameAnswer = (a: { status: number; body: unknown }, b: typeof a) => {
	expect(a.status).toBe(b.status);
	expect(a.body).toEqual(b.body);
};

describe("a space the caller may not read answers like a missing space", () => {
	const missingKey = () => `NOSUCH${randomUUID().slice(0, 6).toUpperCase()}`;

	test("the editor read routes", async () => {
		for (const route of [
			(key: string) => `/api/wiki/edit/space-tree/${key}`,
			(key: string) => `/api/wiki/edit/trash/${key}`,
			(key: string) => `/api/wiki/edit/spaces/${key}/templates`,
			(key: string) => `/api/wiki/edit/spaces/${key}/permissions`,
		]) {
			const real = await outsider.get(route(hidden.key));
			const none = await outsider.get(route(missingKey()));
			expect(none.status, route(hidden.key)).toBe(404);
			sameAnswer(real, none);
		}
	});

	test("the routes that create content", async () => {
		const page = (spaceKey: string) =>
			outsider.post("/api/wiki/pages", {
				spaceKey,
				title: "Probe",
				bodyDoc: doc("probe"),
			});
		sameAnswer(await page(hidden.key), await page(missingKey()));
		const draft = (spaceKey: string) =>
			outsider.post("/api/wiki/pages/drafts", { spaceKey });
		sameAnswer(await draft(hidden.key), await draft(missingKey()));
		const archive = (key: string) =>
			outsider.post(`/api/wiki/spaces/${key}/archive`);
		sameAnswer(await archive(hidden.key), await archive(missingKey()));
	});

	test("a caller who can read the space still gets 403 for what is not allowed", async () => {
		const refused = await viewer.post("/api/wiki/pages", {
			spaceKey: open.key,
			title: "Probe",
			bodyDoc: doc("probe"),
		});
		expect(refused.status).toBe(403);
	});

	test("a template of an unreadable space is as absent as a missing one", async () => {
		const created = await wiki.admin.post(
			`/api/wiki/spaces/${hidden.key}/templates`,
			{ name: "Hidden template", bodyDoc: doc("x") },
		);
		expect(created.status).toBe(201);
		const read = (id: string) => outsider.get(`/api/wiki/edit/templates/${id}`);
		const none = await read(randomUUID());
		expect(none.status).toBe(404);
		sameAnswer(await read(created.body.id), none);
		const change = (id: string) =>
			outsider.put(`/api/wiki/templates/${id}`, {
				name: "x",
				bodyDoc: doc("x"),
			});
		sameAnswer(await change(created.body.id), await change(randomUUID()));
		const remove = (id: string) => outsider.del(`/api/wiki/templates/${id}`);
		sameAnswer(await remove(created.body.id), await remove(randomUUID()));
	});

	test("the legacy trash page", async () => {
		const load = async (key: string) => {
			const response = await wiki.app.inject({
				method: "GET",
				url: `/pages/viewtrash.action?key=${key}`,
				cookies: { sid: outsider.session },
				headers: { accept: "application/json" },
			});
			const shown = /error: (\{status:\d+,message:"[^"]*"\})/.exec(
				response.body,
			);
			return { status: response.statusCode, body: shown?.[1] ?? null };
		};
		const none = await load(missingKey());
		expect(none.status).toBe(404);
		sameAnswer(await load(hidden.key), none);
	});
});

describe("a parent page the caller may not read answers like a missing one", () => {
	const createDraftFrom = async (query: string) => {
		const response = await wiki.app.inject({
			method: "POST",
			url: `/pages/createpage.action?spaceKey=${open.key}&${query}`,
			cookies: { sid: member.session },
			headers: { ...formHeaders, accept: "application/json" },
			payload: "",
		});
		const { status, data } = JSON.parse(response.body);
		return { status: response.statusCode, body: { status, data } };
	};

	test("a source id of the legacy form", async () => {
		const run = Math.floor(Math.random() * 9000) + 1000;
		await pool.query("update pages set source_id = $1 where id = $2", [
			`9${run}01`,
			restrictedId,
		]);
		await pool.query("update pages set source_id = $1 where id = $2", [
			`9${run}02`,
			hiddenSpacePageId,
		]);
		const none = await createDraftFrom(`parentPageId=9${run}99`);
		expect(none.status).toBe(400);
		expect(none.body.data).toContain("parentId");
		sameAnswer(await createDraftFrom(`parentPageId=9${run}01`), none);
		sameAnswer(await createDraftFrom(`fromPageId=9${run}02`), none);
	});

	test("a page id", async () => {
		const none = await createDraftFrom(`parentPageId=${randomUUID()}`);
		expect(none.status).toBe(404);
		sameAnswer(await createDraftFrom(`parentPageId=${restrictedId}`), none);
		sameAnswer(
			await createDraftFrom(`parentPageId=${hiddenSpacePageId}`),
			none,
		);
	});

	test("a readable parent still becomes the draft parent", async () => {
		const response = await createDraftFrom(`parentPageId=${openPageId}`);
		expect(response.status).toBe(200);
	});

	test("the JSON API answers the same for a page id", async () => {
		const draft = (parentId: string) =>
			member.post("/api/wiki/pages/drafts", { spaceKey: open.key, parentId });
		const none = await draft(randomUUID());
		expect(none.status).toBe(404);
		sameAnswer(await draft(restrictedId), none);
		sameAnswer(await draft(hiddenSpacePageId), none);
	});
});
