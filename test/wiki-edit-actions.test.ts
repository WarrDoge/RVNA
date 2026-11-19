import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { type Client, setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let author: Client;

const formHeaders = {
	origin: "http://127.0.0.1:3000",
	"content-type": "application/x-www-form-urlencoded",
};

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("A");
	author = await wiki.user("action-author");
	await wiki.grant(space.id, { userId: author.id }, ["read", "create"]);
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

test("the wiki space home title is in the server HTML", async () => {
	const response = await wiki.app.inject({
		method: "GET",
		url: `/display/${space.key}`,
		cookies: { sid: author.session },
		headers: { accept: "text/html" },
	});
	expect(response.statusCode).toBe(200);
	const { rows } = await pool.query<{ title: string }>(
		"select title from pages where id = $1",
		[space.homeId],
	);
	expect(response.body).toContain(`<title>${rows[0]?.title} - `);
});

describe("page actions validate their query and form input", () => {
	test("an empty fromPageId is a 400, not a database error", async () => {
		const response = await wiki.app.inject({
			method: "POST",
			url: `/pages/createpage.action?spaceKey=${space.key}&fromPageId=`,
			cookies: { sid: author.session },
			headers: formHeaders,
			payload: "",
		});
		expect(response.statusCode).toBe(400);
	});

	test("a numeric Confluence fromPageId is a 400, not a 500", async () => {
		const response = await wiki.app.inject({
			method: "POST",
			url: `/pages/createpage.action?spaceKey=${space.key}&fromPageId=12345`,
			cookies: { sid: author.session },
			headers: formHeaders,
			payload: "",
		});
		expect(response.statusCode).toBe(400);
		expect(response.body).toContain("parentId");
	});

	test("an unknown parentPageId is a 400", async () => {
		const response = await wiki.app.inject({
			method: "POST",
			url: `/pages/createpage.action?spaceKey=${space.key}&parentPageId=not-a-page`,
			cookies: { sid: author.session },
			headers: formHeaders,
			payload: "",
		});
		expect(response.statusCode).toBe(400);
		expect(response.body).toContain("parentId");
	});

	test("a known numeric imported page id becomes the draft parent", async () => {
		const parent = await wiki.page(author, space.key, "Imported parent");
		await pool.query("update pages set source_id = $1 where id = $2", [
			"94000123",
			parent.id,
		]);
		const response = await wiki.app.inject({
			method: "POST",
			url: `/pages/createpage.action?spaceKey=${space.key}&parentPageId=94000123`,
			cookies: { sid: author.session },
			headers: formHeaders,
			payload: "",
		});
		expect(response.statusCode).toBe(200);
		const { rows } = await pool.query<{ parent_id: string | null }>(
			`select p.parent_id from page_drafts d
			 join pages p on p.id = d.page_id
			 where d.user_id = $1 and p.parent_id = $2`,
			[author.id, parent.id],
		);
		expect(rows.length).toBe(1);
	});

	test("a draft id that is not a UUID is a 404", async () => {
		const response = await wiki.app.inject({
			method: "GET",
			url: "/pages/resumedraft.action?draftId=not-a-uuid",
			cookies: { sid: author.session },
		});
		expect(response.statusCode).toBe(404);
	});

	test("a space with an empty or overlong name is refused", async () => {
		const key = `T${wiki.run.toUpperCase()}BAD`;
		const empty = await wiki.app.inject({
			method: "POST",
			url: "/spaces/createspace.action",
			cookies: { sid: wiki.admin.session },
			headers: formHeaders,
			payload: new URLSearchParams({ key, name: "" }).toString(),
		});
		expect(empty.statusCode).toBe(400);

		const long = await wiki.app.inject({
			method: "POST",
			url: "/spaces/createspace.action",
			cookies: { sid: wiki.admin.session },
			headers: formHeaders,
			payload: new URLSearchParams({
				key,
				name: "x".repeat(256),
			}).toString(),
		});
		expect(long.statusCode).toBe(400);
	});
});
