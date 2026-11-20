import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import {
	type Client,
	doc,
	multipart,
	type Reply,
	rows,
	setupWiki,
	type TestSpace,
} from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let nobody: Client;
let reader: Client;
let creator: Client;
let deleter: Client;
let restricter: Client;
let spaceAdmin: Client;
let grouped: Client;
let group: string;

beforeAll(async () => {
	wiki = await setupWiki();
	group = `t-${wiki.run}-staff`;
	space = await wiki.space("A");
	nobody = await wiki.user("nobody");
	reader = await wiki.user("reader");
	creator = await wiki.user("creator");
	deleter = await wiki.user("deleter");
	restricter = await wiki.user("restricter");
	spaceAdmin = await wiki.user("spaceadmin");
	grouped = await wiki.user("grouped", [group]);
	await wiki.grant(space.id, { userId: reader.id }, ["read"]);
	await wiki.grant(space.id, { userId: creator.id }, ["read", "create"]);
	await wiki.grant(space.id, { userId: deleter.id }, [
		"read",
		"create",
		"delete",
	]);
	await wiki.grant(space.id, { userId: restricter.id }, [
		"read",
		"create",
		"restrict",
	]);
	await wiki.grant(space.id, { userId: spaceAdmin.id }, ["administer"]);
	await wiki.grant(space.id, { group }, ["read", "create"]);
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

const mk = (title: string, parentId?: string | null, as: Client = wiki.admin) =>
	wiki.page(as, space.key, title, { parentId });

const updateBody = { bodyDoc: doc("changed") };

describe("space permission mapping", () => {
	test("a user without permissions sees and changes nothing", async () => {
		const page = await mk("Mapping hidden");
		expect((await nobody.get(`/api/wiki/edit/pages/${page.id}`)).status).toBe(
			404,
		);
		expect(
			(await nobody.put(`/api/wiki/pages/${page.id}`, updateBody)).status,
		).toBe(404);
		expect(
			(
				await nobody.post("/api/wiki/pages", {
					spaceKey: space.key,
					title: "x",
					bodyDoc: doc("x"),
				})
			).status,
		).toBe(403);
		const spaces = await nobody.get("/api/wiki/edit/spaces");
		expect(spaces.body.map((s: { key: string }) => s.key)).not.toContain(
			space.key,
		);
		const tree = await nobody.get(`/api/wiki/edit/space-tree/${space.key}`);
		expect(tree.status).toBe(403);
		const search = await nobody.get(
			`/api/wiki/edit/page-search?q=Mapping&spaceKey=${space.key}`,
		);
		expect(search.body).toEqual([]);
	});

	test("read lets a user view the editor context but not edit", async () => {
		const page = await mk("Mapping read");
		const context = await reader.get(`/api/wiki/edit/pages/${page.id}`);
		expect(context.status).toBe(200);
		expect(context.body.permissions).toEqual({
			canEdit: false,
			canRestrict: false,
			canDelete: false,
		});
		expect(
			(await reader.put(`/api/wiki/pages/${page.id}`, updateBody)).status,
		).toBe(403);
		expect(
			(
				await reader.post(`/api/wiki/pages/${page.id}/rename`, {
					title: "Nope",
				})
			).status,
		).toBe(403);
		expect(
			(await reader.post(`/api/wiki/pages/${page.id}/move`, { position: 0 }))
				.status,
		).toBe(403);
		const spaces = await reader.get("/api/wiki/edit/spaces");
		expect(
			spaces.body.find((s: { key: string }) => s.key === space.key),
		).toMatchObject({ canCreate: false });
		const copied = await reader.post(`/api/wiki/pages/${page.id}/copy`, {
			title: "Reader copy",
		});
		expect(copied.status).toBe(403);
	});

	test("create covers edit, rename, move, copy, restore version and upload", async () => {
		const page = await mk("Mapping create");
		const context = await creator.get(`/api/wiki/edit/pages/${page.id}`);
		expect(context.body.permissions).toEqual({
			canEdit: true,
			canRestrict: false,
			canDelete: false,
		});
		expect(
			(await creator.put(`/api/wiki/pages/${page.id}`, updateBody)).status,
		).toBe(200);
		expect(
			(
				await creator.post(`/api/wiki/pages/${page.id}/rename`, {
					title: "Mapping create 2",
				})
			).status,
		).toBe(200);
		expect(
			(await creator.post(`/api/wiki/pages/${page.id}/move`, { position: 0 }))
				.status,
		).toBe(200);
		expect(
			(
				await creator.post(`/api/wiki/pages/${page.id}/restore-version`, {
					version: 1,
				})
			).status,
		).toBe(200);
		expect(
			(
				await creator.post(`/api/wiki/pages/${page.id}/copy`, {
					title: "Mapping create copy",
				})
			).status,
		).toBe(201);
		const upload = multipart({
			name: "a.txt",
			type: "text/plain",
			content: "a",
		});
		expect(
			(
				await creator.raw(
					"POST",
					`/api/wiki/pages/${page.id}/attachments`,
					upload.payload,
					upload.contentType,
				)
			).status,
		).toBe(201);
		expect(
			(await creator.post(`/api/wiki/pages/${page.id}/trash`)).status,
		).toBe(403);
		expect(
			(
				await creator.put(`/api/wiki/pages/${page.id}/restrictions`, {
					read: { userIds: [], groups: [] },
					update: { userIds: [], groups: [] },
				})
			).status,
		).toBe(403);
	});

	test("delete allows trash, restrict allows restrictions, only administer purges", async () => {
		const page = await mk("Mapping delete");
		expect(
			(await deleter.post(`/api/wiki/pages/${page.id}/trash`)).status,
		).toBe(200);
		expect((await deleter.del(`/api/wiki/pages/${page.id}`)).status).toBe(403);
		expect((await spaceAdmin.del(`/api/wiki/pages/${page.id}`)).status).toBe(
			204,
		);

		const other = await mk("Mapping restrict");
		const set = await restricter.put(
			`/api/wiki/pages/${other.id}/restrictions`,
			{
				read: { userIds: [], groups: [] },
				update: { userIds: [restricter.id], groups: [] },
			},
		);
		expect(set.status).toBe(200);
	});

	test("restore needs the same capability as moving a page to the trash", async () => {
		const page = await mk("Moderated restore");
		expect(
			(await creator.post(`/api/wiki/pages/${page.id}/trash`)).status,
		).toBe(403);
		expect(
			(await deleter.post(`/api/wiki/pages/${page.id}/trash`)).status,
		).toBe(200);
		expect(
			(await creator.post(`/api/wiki/pages/${page.id}/restore`)).status,
		).toBe(403);
		expect(
			(await deleter.post(`/api/wiki/pages/${page.id}/restore`)).status,
		).toBe(200);
	});

	test("administer implies every permission of its space", async () => {
		const page = await mk("Mapping administer");
		expect(
			(await spaceAdmin.put(`/api/wiki/pages/${page.id}`, updateBody)).status,
		).toBe(200);
		expect(
			(await spaceAdmin.post(`/api/wiki/pages/${page.id}/trash`)).status,
		).toBe(200);
		expect((await spaceAdmin.del(`/api/wiki/pages/${page.id}`)).status).toBe(
			204,
		);
	});

	test("group grants and anonymous grants apply to members and everyone", async () => {
		const page = await mk("Mapping group");
		expect(
			(await grouped.put(`/api/wiki/pages/${page.id}`, updateBody)).status,
		).toBe(200);

		const open = await wiki.space("O");
		const page2 = await wiki.page(wiki.admin, open.key, "Open page");
		expect((await nobody.get(`/api/wiki/edit/pages/${page2.id}`)).status).toBe(
			404,
		);
		await wiki.grant(open.id, { anonymous: true }, ["read"]);
		expect((await nobody.get(`/api/wiki/edit/pages/${page2.id}`)).status).toBe(
			200,
		);
		expect(
			(await nobody.put(`/api/wiki/pages/${page2.id}`, updateBody)).status,
		).toBe(403);
	});

	test("an app admin needs no permission rows", async () => {
		const bare = await wiki.space("B");
		await pool.query("delete from space_permissions where space_id = $1", [
			bare.id,
		]);
		const page = await wiki.page(wiki.admin, bare.key, "Admin only");
		expect(
			(await wiki.admin.put(`/api/wiki/pages/${page.id}`, updateBody)).status,
		).toBe(200);
	});
});

describe("page restrictions", () => {
	test("update restrictions apply to the page itself, not to its descendants", async () => {
		const top = await mk("Locked top");
		const child = await mk("Locked child", top.id);
		const sibling = await mk("Free sibling");
		const set = await wiki.admin.put(`/api/wiki/pages/${top.id}/restrictions`, {
			read: { userIds: [], groups: [] },
			update: { userIds: [restricter.id], groups: [] },
		});
		expect(set.status).toBe(200);
		expect(set.body.update.users.map((u: { id: string }) => u.id)).toEqual([
			restricter.id,
		]);

		const routes: [string, number, (id: string) => Promise<Reply>][] = [
			["update", 200, (id) => deleter.put(`/api/wiki/pages/${id}`, updateBody)],
			[
				"rename",
				200,
				(id) =>
					deleter.post(`/api/wiki/pages/${id}/rename`, {
						title: `Renamed ${id}`,
					}),
			],
			[
				"move",
				200,
				(id) =>
					deleter.post(`/api/wiki/pages/${id}/move`, { parentId: sibling.id }),
			],
			[
				"restore version",
				200,
				(id) =>
					deleter.post(`/api/wiki/pages/${id}/restore-version`, { version: 1 }),
			],
			["trash", 200, (id) => deleter.post(`/api/wiki/pages/${id}/trash`)],
			[
				"labels",
				200,
				(id) => deleter.put(`/api/wiki/pages/${id}/labels`, { labels: ["a"] }),
			],
			[
				"order",
				204,
				(id) =>
					deleter.post(`/api/wiki/pages/${id}/children/order`, {
						childIds: [],
					}),
			],
			[
				"draft",
				200,
				(id) =>
					deleter.put(`/api/wiki/pages/${id}/draft`, {
						title: "t",
						bodyDoc: doc("d"),
					}),
			],
			[
				"attachment",
				201,
				(id) => {
					const upload = multipart({
						name: "x.txt",
						type: "text/plain",
						content: "x",
					});
					return deleter.raw(
						"POST",
						`/api/wiki/pages/${id}/attachments`,
						upload.payload,
						upload.contentType,
					);
				},
			],
			["lock", 200, (id) => deleter.post(`/api/wiki/pages/${id}/lock`)],
		];

		const refused = routes.map(async ([name, , run]) => {
			const response = await run(top.id);
			return [name, response.status] as const;
		});
		for (const [name, status] of await Promise.all(refused)) {
			expect([name, status]).toEqual([name, 403]);
		}

		for (const [name, expected, run] of routes) {
			const fresh = await mk(`Locked child ${name}`, top.id);
			const response = await run(fresh.id);
			expect([name, response.status]).toEqual([name, expected]);
		}

		const context = await deleter.get(`/api/wiki/edit/pages/${child.id}`);
		expect(context.body.permissions.canEdit).toBe(true);
		expect(
			(await deleter.get(`/api/wiki/edit/pages/${top.id}`)).body.permissions
				.canEdit,
		).toBe(false);
		expect(
			(await restricter.put(`/api/wiki/pages/${top.id}`, updateBody)).status,
		).toBe(200);
		expect(
			(await spaceAdmin.put(`/api/wiki/pages/${child.id}`, updateBody)).status,
		).toBe(200);
	});

	test("read restrictions hide the page and its descendants", async () => {
		const top = await mk("Secret top");
		const child = await mk("Secret child", top.id);
		await wiki.admin.put(`/api/wiki/pages/${top.id}/restrictions`, {
			read: { userIds: [reader.id], groups: [] },
			update: { userIds: [], groups: [] },
		});
		for (const id of [top.id, child.id]) {
			expect((await creator.get(`/api/wiki/edit/pages/${id}`)).status).toBe(
				404,
			);
			expect(
				(await creator.put(`/api/wiki/pages/${id}`, updateBody)).status,
			).toBe(404);
			expect(
				(
					await creator.post(`/api/wiki/pages/${id}/copy`, {
						title: `Copy ${id}`,
					})
				).status,
			).toBe(404);
			expect((await reader.get(`/api/wiki/edit/pages/${id}`)).status).toBe(200);
		}

		const upload = multipart({
			name: "x.txt",
			type: "text/plain",
			content: "x",
		});
		const restrictions = {
			read: { userIds: [], groups: [] },
			update: { userIds: [], groups: [] },
		};
		const blocked = [
			deleter.put(`/api/wiki/pages/${child.id}`, updateBody),
			deleter.post(`/api/wiki/pages/${child.id}/rename`, {
				title: "Renamed secret",
			}),
			deleter.post(`/api/wiki/pages/${child.id}/move`, { parentId: null }),
			deleter.post(`/api/wiki/pages/${child.id}/restore-version`, {
				version: 1,
			}),
			deleter.post(`/api/wiki/pages/${child.id}/trash`),
			deleter.post(`/api/wiki/pages/${child.id}/restore`),
			deleter.del(`/api/wiki/pages/${child.id}`),
			deleter.post(`/api/wiki/pages/${child.id}/copy`, {
				title: "Secret copy",
			}),
			deleter.put(`/api/wiki/pages/${child.id}/labels`, { labels: ["a"] }),
			deleter.post(`/api/wiki/pages/${child.id}/children/order`, {
				childIds: [],
			}),
			deleter.put(`/api/wiki/pages/${child.id}/draft`, {
				title: "t",
				bodyDoc: doc("d"),
			}),
			deleter.del(`/api/wiki/pages/${child.id}/draft`),
			deleter.get(`/api/wiki/edit/pages/${child.id}`),
			deleter.get(`/api/wiki/edit/pages/${child.id}/restrictions`),
			deleter.put(`/api/wiki/pages/${child.id}/restrictions`, restrictions),
			deleter.raw(
				"POST",
				`/api/wiki/pages/${child.id}/attachments`,
				upload.payload,
				upload.contentType,
			),
			deleter.post(`/api/wiki/pages/${child.id}/lock`),
		];
		for (const response of await Promise.all(blocked)) {
			expect(response.status).toBe(404);
		}

		const tree = await creator.get(`/api/wiki/edit/space-tree/${space.key}`);
		const ids = tree.body.map((n: { id: string }) => n.id);
		expect(ids).not.toContain(top.id);
		expect(ids).not.toContain(child.id);
		const search = await creator.get(
			`/api/wiki/edit/page-search?q=Secret&spaceKey=${space.key}`,
		);
		expect(search.body).toEqual([]);
		const found = await reader.get(
			`/api/wiki/edit/page-search?q=Secret&spaceKey=${space.key}`,
		);
		expect(found.body).toHaveLength(2);
	});

	test("discarding a draft answers 404 for a page the caller cannot read", async () => {
		const page = await mk("Secret discard");
		await wiki.admin.put(`/api/wiki/pages/${page.id}/restrictions`, {
			read: { userIds: [reader.id], groups: [] },
			update: { userIds: [], groups: [] },
		});

		const unknown = await creator.del(`/api/wiki/pages/${randomUUID()}/draft`);
		const hidden = await creator.del(`/api/wiki/pages/${page.id}/draft`);
		expect(hidden.status).toBe(unknown.status);
		expect(hidden.status).toBe(404);
		expect(hidden.body).toEqual(unknown.body);
	});

	test("a group listed in a restriction grants its members access", async () => {
		const page = await mk("Group locked");
		await wiki.admin.put(`/api/wiki/pages/${page.id}/restrictions`, {
			read: { userIds: [], groups: [] },
			update: { userIds: [], groups: [group] },
		});
		expect(
			(await creator.put(`/api/wiki/pages/${page.id}`, updateBody)).status,
		).toBe(403);
		expect(
			(await grouped.put(`/api/wiki/pages/${page.id}`, updateBody)).status,
		).toBe(200);
	});

	test("restrictions are reported with the inherited view restrictions, nearest first", async () => {
		const top = await mk("Report top");
		const mid = await mk("Report mid", top.id);
		const leaf = await mk("Report leaf", mid.id);
		await wiki.admin.put(`/api/wiki/pages/${top.id}/restrictions`, {
			read: { userIds: [], groups: [group] },
			update: { userIds: [], groups: [group] },
		});
		await wiki.admin.put(`/api/wiki/pages/${mid.id}/restrictions`, {
			read: { userIds: [], groups: [] },
			update: { userIds: [grouped.id], groups: [] },
		});
		await wiki.admin.put(`/api/wiki/pages/${leaf.id}/restrictions`, {
			read: { userIds: [], groups: [] },
			update: { userIds: [grouped.id], groups: [] },
		});
		const report = await grouped.get(
			`/api/wiki/edit/pages/${leaf.id}/restrictions`,
		);
		expect(report.status).toBe(200);
		expect(report.body.read.groups).toEqual([]);
		expect(report.body.update.users.map((u: { id: string }) => u.id)).toEqual([
			grouped.id,
		]);
		expect(
			report.body.inherited.map((i: { title: string }) => i.title),
		).toEqual(["Report top"]);
		expect(report.body.inherited[0].read.groups).toEqual([group]);
		expect(report.body.inherited[0].update).toEqual({ users: [], groups: [] });
		expect(
			(await creator.get(`/api/wiki/edit/pages/${leaf.id}/restrictions`))
				.status,
		).toBe(404);
	});

	test("a change that would lock the caller out is refused unless they administer", async () => {
		const page = await mk("Lockout");
		const refused = await restricter.put(
			`/api/wiki/pages/${page.id}/restrictions`,
			{
				read: { userIds: [], groups: [] },
				update: { userIds: [creator.id], groups: [] },
			},
		);
		expect(refused.status).toBe(400);
		const readLock = await restricter.put(
			`/api/wiki/pages/${page.id}/restrictions`,
			{
				read: { userIds: [creator.id], groups: [] },
				update: { userIds: [], groups: [] },
			},
		);
		expect(readLock.status).toBe(400);
		expect(
			await rows("select 1 from page_restrictions where page_id = $1", [
				page.id,
			]),
		).toHaveLength(0);

		const ok = await restricter.put(`/api/wiki/pages/${page.id}/restrictions`, {
			read: { userIds: [], groups: [] },
			update: { userIds: [creator.id, restricter.id], groups: [] },
		});
		expect(ok.status).toBe(200);

		const byAdmin = await spaceAdmin.put(
			`/api/wiki/pages/${page.id}/restrictions`,
			{
				read: { userIds: [], groups: [] },
				update: { userIds: [creator.id], groups: [] },
			},
		);
		expect(byAdmin.status).toBe(200);
		const cleared = await spaceAdmin.put(
			`/api/wiki/pages/${page.id}/restrictions`,
			{
				read: { userIds: [], groups: [] },
				update: { userIds: [], groups: [] },
			},
		);
		expect(cleared.body.update).toEqual({ users: [], groups: [] });
	});

	test("unknown users are rejected", async () => {
		const page = await mk("Unknown subject");
		const refused = await wiki.admin.put(
			`/api/wiki/pages/${page.id}/restrictions`,
			{
				read: { userIds: ["00000000-0000-4000-8000-000000000000"], groups: [] },
				update: { userIds: [], groups: [] },
			},
		);
		expect(refused.status).toBe(400);
	});
});

describe("space permissions", () => {
	test("space admins read and replace the permission set", async () => {
		const own = await wiki.space("PM");
		await wiki.grant(own.id, { userId: spaceAdmin.id }, ["administer"]);
		await wiki.grant(own.id, { userId: reader.id }, ["read"]);
		expect(
			(await reader.get(`/api/wiki/edit/spaces/${own.key}/permissions`)).status,
		).toBe(403);
		const listed = await spaceAdmin.get(
			`/api/wiki/edit/spaces/${own.key}/permissions`,
		);
		expect(listed.status).toBe(200);
		expect(
			listed.body.some(
				(r: { permission: string; user: { id: string } | null }) =>
					r.permission === "read" && r.user?.id === reader.id,
			),
		).toBe(true);

		const put = await spaceAdmin.put(
			`/api/wiki/spaces/${own.key}/permissions`,
			{
				permissions: [
					{ permission: "administer", userId: spaceAdmin.id },
					{ permission: "read", userId: reader.id },
					{ permission: "create", userId: reader.id },
					{ permission: "read", groupName: group },
					{ permission: "read", userId: reader.id },
					{ permission: "read", anonymous: true },
				],
			},
		);
		expect(put.status).toBe(200);
		expect(put.body).toHaveLength(5);
		expect(
			put.body.find((r: { anonymous: boolean }) => r.anonymous),
		).toMatchObject({ permission: "read", user: null, groupName: null });
		const page = await wiki.page(wiki.admin, own.key, "Perm page");
		expect(
			(await reader.put(`/api/wiki/pages/${page.id}`, updateBody)).status,
		).toBe(200);
		expect((await nobody.get(`/api/wiki/edit/pages/${page.id}`)).status).toBe(
			200,
		);
	});

	test("refuses a set that removes the caller's own administer, bad targets and unknown users", async () => {
		const own = await wiki.space("PN");
		await wiki.grant(own.id, { userId: spaceAdmin.id }, ["administer"]);
		const lockOut = await spaceAdmin.put(
			`/api/wiki/spaces/${own.key}/permissions`,
			{
				permissions: [{ permission: "read", userId: spaceAdmin.id }],
			},
		);
		expect(lockOut.status).toBe(400);
		const both = await spaceAdmin.put(
			`/api/wiki/spaces/${own.key}/permissions`,
			{
				permissions: [
					{ permission: "administer", userId: spaceAdmin.id },
					{ permission: "read", userId: reader.id, groupName: group },
				],
			},
		);
		expect(both.status).toBe(400);
		const unknown = await spaceAdmin.put(
			`/api/wiki/spaces/${own.key}/permissions`,
			{
				permissions: [
					{ permission: "administer", userId: spaceAdmin.id },
					{
						permission: "read",
						userId: "00000000-0000-4000-8000-000000000000",
					},
				],
			},
		);
		expect(unknown.status).toBe(400);
		const bogus = await spaceAdmin.put(
			`/api/wiki/spaces/${own.key}/permissions`,
			{
				permissions: [{ permission: "fly", userId: spaceAdmin.id }],
			},
		);
		expect(bogus.status).toBe(400);
		const kept = await spaceAdmin.get(
			`/api/wiki/edit/spaces/${own.key}/permissions`,
		);
		expect(kept.body).toHaveLength(7);

		const byApp = await wiki.admin.put(
			`/api/wiki/spaces/${own.key}/permissions`,
			{
				permissions: [{ permission: "read", userId: reader.id }],
			},
		);
		expect(byApp.status).toBe(200);
	});
});

describe("group type-ahead", () => {
	test("a non-admin only sees groups they belong to", async () => {
		const other = `t-${wiki.run}-other`;
		await pool.query(
			"insert into groups (name) values ($1) on conflict (name) do nothing",
			[other],
		);
		await wiki.grant(space.id, { group: other }, ["read"]);

		const query = encodeURIComponent(`t-${wiki.run}`);
		const adminHits = await wiki.admin.get(`/api/wiki/edit/groups?q=${query}`);
		expect(adminHits.status).toBe(200);
		expect(adminHits.body).toEqual(expect.arrayContaining([group, other]));

		const userHits = await grouped.get(`/api/wiki/edit/groups?q=${query}`);
		expect(userHits.status).toBe(200);
		expect(userHits.body).toContain(group);
		expect(userHits.body).not.toContain(other);
	});
});
