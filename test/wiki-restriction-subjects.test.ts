import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { type Client, setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let restricter: Client;
let spaceAdmin: Client;
let member: Client;
let gone: Client;
let ownGroup: string;
let foreignGroup: string;

const refused = { error: "A user or group in the restrictions cannot be used" };

beforeAll(async () => {
	wiki = await setupWiki();
	ownGroup = `t-${wiki.run}-own`;
	foreignGroup = `t-${wiki.run}-foreign`;
	space = await wiki.space("R");
	restricter = await wiki.user("restricter", [ownGroup]);
	spaceAdmin = await wiki.user("spaceadmin");
	member = await wiki.user("member", [foreignGroup]);
	gone = await wiki.user("gone");
	await pool.query("update users set active = false where id = $1", [gone.id]);
	await wiki.grant(space.id, { userId: restricter.id }, [
		"read",
		"create",
		"restrict",
	]);
	await wiki.grant(space.id, { userId: spaceAdmin.id }, ["administer"]);
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

const body = (userIds: string[], groups: string[] = []) => ({
	read: { userIds, groups },
	update: { userIds: [], groups: [] },
});

const put = (client: Client, pageId: string, payload: unknown) =>
	client.put(`/api/wiki/pages/${pageId}/restrictions`, payload);

describe("who a page restriction may name", () => {
	test("a caller names active users and their own groups", async () => {
		const page = await wiki.page(restricter, space.key, "Names allowed");
		const reply = await put(
			restricter,
			page.id,
			body([restricter.id, member.id], [ownGroup]),
		);
		expect(reply.status).toBe(200);
	});

	test("an unknown user, an inactive user and a foreign group get one answer", async () => {
		const page = await wiki.page(restricter, space.key, "Names refused");
		const answers = [
			await put(restricter, page.id, body([restricter.id, randomUUID()])),
			await put(restricter, page.id, body([restricter.id, gone.id])),
			await put(restricter, page.id, body([restricter.id], [foreignGroup])),
			await put(
				restricter,
				page.id,
				body([restricter.id], [`t-${wiki.run}-nobody`]),
			),
		];
		for (const answer of answers) {
			expect(answer.status).toBe(400);
			expect(answer.body).toEqual(refused);
		}
	});

	test("what the page already names stays usable, so an unchanged list saves", async () => {
		const page = await wiki.page(restricter, space.key, "Names kept");
		const list = body([restricter.id, gone.id], [foreignGroup]);
		expect((await put(spaceAdmin, page.id, list)).status).toBe(200);
		expect((await put(restricter, page.id, list)).status).toBe(200);
		const dropped = await put(restricter, page.id, body([restricter.id]));
		expect(dropped.status).toBe(200);
		expect((await put(restricter, page.id, list)).status).toBe(400);
	});

	test("an administrator of the space may name any existing user and any group", async () => {
		const page = await wiki.page(restricter, space.key, "Names admin");
		expect(
			(await put(wiki.admin, page.id, body([gone.id], [foreignGroup, "free"])))
				.status,
		).toBe(200);
		expect(
			(await put(spaceAdmin, page.id, body([member.id], [foreignGroup])))
				.status,
		).toBe(200);
		const unknown = await put(spaceAdmin, page.id, body([randomUUID()]));
		expect(unknown.status).toBe(400);
		expect(unknown.body).toEqual(refused);
	});
});
