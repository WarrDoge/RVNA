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
let member: Client;

beforeAll(async () => {
	wiki = await setupWiki();
	open = await wiki.space("O");
	member = await wiki.user("member");
	await wiki.grant(open.id, { userId: member.id }, ["read", "create"]);
	const restrictedId = (
		await wiki.page(wiki.admin, open.key, "Restricted memo")
	).id;
	const restricted = await wiki.admin.put(
		`/api/wiki/pages/${restrictedId}/restrictions`,
		{
			read: { userIds: [wiki.admin.id], groups: [] },
			update: { userIds: [], groups: [] },
		},
	);
	expect(restricted.status).toBe(200);
	await wiki.page(wiki.admin, open.key, "Open memo");
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

describe("a page title collision does not confirm a page the caller cannot read", () => {
	const taken = (title: string) =>
		`The title "${title}" is not available in this space. Choose another title.`;

	test("create answers the same for a hidden page and a visible one", async () => {
		const create = (title: string) =>
			member.post("/api/wiki/pages", {
				spaceKey: open.key,
				title,
				bodyDoc: doc("probe"),
			});
		for (const title of ["Restricted memo", "Open memo"]) {
			const refused = await create(title);
			expect(refused.status).toBe(409);
			expect(refused.body).toEqual({ error: taken(title) });
		}
		expect((await create("A free title")).status).toBe(201);
	});

	test("rename and copy answer the same way", async () => {
		const own = await wiki.page(member, open.key, "Own page");
		const rename = await member.post(`/api/wiki/pages/${own.id}/rename`, {
			title: "Restricted memo",
		});
		expect(rename.status).toBe(409);
		expect(rename.body).toEqual({ error: taken("Restricted memo") });
		const copy = await member.post(`/api/wiki/pages/${own.id}/copy`, {
			title: "Restricted memo",
		});
		expect(copy.status).toBe(409);
		expect(copy.body).toEqual({ error: taken("Restricted memo") });
	});
});
