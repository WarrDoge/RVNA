import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ConfluenceClient } from "../src/importer/confluence.ts";
import { db, pool, runMigrations } from "../src/importer/db.ts";
import type { WikiFetchResult } from "../src/importer/wiki-fetch.ts";
import { fetchWikiDataset } from "../src/importer/wiki-fetch.ts";
import { importWikiDataset } from "../src/importer/wiki-import.ts";
import { users } from "../src/lib/server/schema.ts";
import { pageWatchers } from "../src/lib/server/schema-wiki-social.ts";

const baseUrl = "https://confluence.example.test";
const spaceKey = "FXSOC";
const pageId = "7001";
const childId = "7002";

const directoryUsers = [
	{
		userKey: "uk-one",
		username: "fixture-social-one",
		displayName: "Fixture Social One",
	},
	{
		userKey: "uk-two",
		username: "fixture-social-two",
		displayName: "Fixture Social Two",
	},
	{
		userKey: "uk-app",
		username: "fixture-social-app",
		displayName: "Fixture Social App",
	},
];

interface SocialState {
	pageWatchers: Record<string, unknown[]>;
	spaceWatchers: unknown[];
	likes: Record<string, unknown[]>;
}

function initialSocial(): SocialState {
	return {
		pageWatchers: {
			[pageId]: [
				{
					name: "fixture-social-one",
					fullName: "Fixture Social One",
					userKey: "uk-one",
				},
				{
					username: "fixture-social-two",
					fullName: "Fixture Social Two",
					key: "uk-two",
				},
				{ name: "unknown-watcher", fullName: "Unknown Watcher" },
				{ fullName: "No Keys" },
			],
			[childId]: [
				{
					name: "fixture-social-two",
					fullName: "Fixture Social Two",
					userKey: "uk-two",
				},
			],
		},
		spaceWatchers: [
			{
				name: "fixture-social-one",
				fullName: "Fixture Social One",
				userKey: "uk-one",
			},
			{
				name: "fixture-social-two",
				fullName: "Fixture Social Two",
				userKey: "uk-two",
			},
		],
		likes: {
			[pageId]: [
				{
					user: {
						name: "fixture-social-one",
						fullName: "Fixture Social One",
						userKey: "uk-one",
					},
				},
			],
			[childId]: [],
		},
	};
}

function pageContent(id: string, parentId: string | null) {
	return {
		id,
		type: "page",
		status: "current",
		title: `Social ${id}`,
		space: { key: spaceKey },
		version: {
			number: 1,
			by: { userKey: "uk-one", username: "fixture-social-one" },
			when: "2026-02-01T10:00:00.345+02:00",
		},
		history: {
			createdDate: "2026-02-01T09:00:00.123+02:00",
			createdBy: { userKey: "uk-one", username: "fixture-social-one" },
		},
		ancestors: parentId ? [{ id: parentId }] : [],
		body: {
			storage: { value: `<p>Social ${id}</p>` },
			view: { value: `<p>Social ${id}</p>` },
		},
		metadata: { labels: { results: [] } },
	};
}

function clientFor(
	social: SocialState,
	options: { badShape?: boolean } = {},
): { client: ConfluenceClient; calls: string[] } {
	const calls: string[] = [];
	const fetchImpl = (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		const path = url.pathname;
		calls.push(`${path}${url.search}`);
		// These list endpoints page from zero and the fixture has one page.
		if (Number(url.searchParams.get("start") ?? 0) > 0) {
			return Response.json({ results: [] });
		}
		if (path === "/rest/api/user/list") {
			return Response.json({ results: directoryUsers });
		}
		if (path === "/rest/api/space") {
			return Response.json({
				results:
					url.searchParams.get("status") === "current"
						? [
								{
									id: "9101",
									key: spaceKey,
									name: "Fixture Social Space",
									type: "global",
									status: "current",
									homepage: { id: pageId },
								},
							]
						: [],
			});
		}
		if (path === `/rest/api/space/${spaceKey}/permissions`) {
			return Response.json([]);
		}
		if (path === "/rest/api/content") {
			const type = url.searchParams.get("type");
			const status = url.searchParams.get("status");
			return Response.json({
				results:
					type === "page" && status === "current"
						? [pageContent(pageId, null), pageContent(childId, pageId)]
						: [],
			});
		}
		if (path === `/rest/api/space/${spaceKey}/content`) {
			return Response.json({
				page: { results: [{ id: pageId }] },
				blogpost: { results: [] },
			});
		}
		if (path === `/rest/api/content/${pageId}/child/page`) {
			return Response.json({ results: [{ id: childId }] });
		}
		if (path === `/rest/api/content/${childId}/child/page`) {
			return Response.json({ results: [] });
		}
		if (path.endsWith("/child/comment") || path.endsWith("/child/attachment")) {
			return Response.json({ results: [] });
		}
		if (path.startsWith("/rest/experimental/content/")) {
			return Response.json({
				results: [
					{
						number: 1,
						by: { userKey: "uk-one", username: "fixture-social-one" },
						when: "2026-02-01T10:00:00.345+02:00",
					},
				],
			});
		}
		if (path === "/json/listwatchers.action") {
			if (options.badShape) {
				return Response.json({ unexpected: "secret-value" });
			}
			const id = url.searchParams.get("pageId") ?? "";
			return Response.json({
				pageWatchers: social.pageWatchers[id] ?? [],
				spaceWatchers: social.spaceWatchers,
			});
		}
		if (path.startsWith("/rest/likes/1.0/content/")) {
			if (options.badShape) {
				return Response.json({ likes: "secret-value" });
			}
			const id = path.split("/").at(-2) ?? "";
			return Response.json({
				content_id: id,
				likes: social.likes[id] ?? [],
			});
		}
		return new Response("missing", { status: 404 });
	}) as typeof fetch;
	return {
		client: new ConfluenceClient({
			baseUrl,
			token: "fixture-token",
			fetchImpl,
		}),
		calls,
	};
}

async function fetchFixture(social: SocialState) {
	return fetchWikiDataset(clientFor(social).client, {
		attachmentsDir: "/tmp",
		skipAttachments: true,
		privateApis: true,
	});
}

async function cleanup() {
	await pool.query("delete from spaces where key = $1", [spaceKey]);
	await pool.query("delete from users where username like 'fixture-social-%'");
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("Confluence page and space watchers and page likes", () => {
	let dataset: WikiFetchResult;

	test("fetches watchers and likes with two requests per page", async () => {
		const social = initialSocial();
		const { client, calls } = clientFor(social);
		dataset = await fetchWikiDataset(client, {
			attachmentsDir: "/tmp",
			skipAttachments: true,
			privateApis: true,
		});
		const socialCalls = calls.filter(
			(call) =>
				call.startsWith("/json/listwatchers.action") ||
				call.startsWith("/rest/likes/1.0/content/"),
		);
		expect(socialCalls).toHaveLength(4);
		expect(
			socialCalls.filter((call) => call.startsWith("/json/listwatchers")),
		).toHaveLength(2);
		expect(
			socialCalls.filter((call) => call.startsWith("/rest/likes/1.0/content/")),
		).toHaveLength(2);
		expect(dataset.socialShapeKeys.size).toBe(0);
		const space = dataset.spaces.find((item) => item.space.key === spaceKey);
		expect(space?.spaceWatchers.map((user) => user.username).sort()).toEqual([
			"fixture-social-one",
			"fixture-social-two",
		]);
		const page = space?.pages.find((item) => item.sourceId === pageId);
		expect(page?.watchers.map((user) => user.username).sort()).toEqual([
			"fixture-social-one",
			"fixture-social-two",
			"unknown-watcher",
		]);
		expect(page?.likes.map((user) => user.username)).toEqual([
			"fixture-social-one",
		]);
	});

	test("imports the rows once and counts unknown users", async () => {
		const first = await importWikiDataset(dataset, {
			baseUrl,
			privateApis: true,
		});
		expect(first.counts.page_watchers).toEqual({
			inserted: 3,
			updated: 0,
			unchanged: 0,
		});
		expect(first.counts.space_watchers).toEqual({
			inserted: 2,
			updated: 0,
			unchanged: 0,
		});
		expect(first.counts.page_likes).toEqual({
			inserted: 1,
			updated: 0,
			unchanged: 0,
		});
		expect(first.social).toEqual({
			unknownPageWatchers: 1,
			unknownSpaceWatchers: 0,
			unknownLikes: 0,
		});

		const { rows: spaceRowsResult } = await pool.query<{ id: string }>(
			"select id from spaces where key = $1",
			[spaceKey],
		);
		const { rows: pageRowsResult } = await pool.query<{ id: string }>(
			"select id from pages where source_id = $1",
			[pageId],
		);
		const space = spaceRowsResult[0];
		const page = pageRowsResult[0];
		expect(space).toBeDefined();
		expect(page).toBeDefined();
		const pageCreated = await pool.query<{ created: Date | null }>(
			"select created from pages where id = $1",
			[page?.id],
		);
		expect(pageCreated.rows[0]?.created?.toISOString()).toBe(
			"2026-02-01T07:00:00.123Z",
		);
		const versionCreated = await pool.query<{ created: Date | null }>(
			"select created from page_versions where source_id = $1",
			[`${pageId}@1`],
		);
		expect(versionCreated.rows[0]?.created?.toISOString()).toBe(
			"2026-02-01T08:00:00.345Z",
		);
		const watcherRows = await pool.query<{
			username: string;
			source_id: string;
		}>(
			`select users.username, watcher.source_id
			 from page_watchers watcher
			 join users on users.id = watcher.user_id
			 where watcher.page_id = $1
			 order by users.username`,
			[page?.id],
		);
		expect(watcherRows.rows.map((row) => row.username)).toEqual([
			"fixture-social-one",
			"fixture-social-two",
		]);
		expect(
			watcherRows.rows.every((row) => row.source_id.startsWith("confluence:")),
		).toBe(true);
		const spaceWatcherRows = await pool.query<{ count: number }>(
			"select count(*)::int as count from space_watchers where space_id = $1",
			[space?.id],
		);
		expect(spaceWatcherRows.rows[0]?.count).toBe(2);
		const likeRows = await pool.query<{ count: number }>(
			"select count(*)::int as count from page_likes where page_id = $1",
			[page?.id],
		);
		expect(likeRows.rows[0]?.count).toBe(1);
	});

	test("a second import reports the same rows as unchanged", async () => {
		const second = await importWikiDataset(dataset, {
			baseUrl,
			privateApis: true,
		});
		expect(second.counts.page_watchers).toEqual({
			inserted: 0,
			updated: 0,
			unchanged: 3,
		});
		expect(second.counts.space_watchers).toEqual({
			inserted: 0,
			updated: 0,
			unchanged: 2,
		});
		expect(second.counts.page_likes).toEqual({
			inserted: 0,
			updated: 0,
			unchanged: 1,
		});
	});

	test("without private APIs an import leaves watchers and likes alone", async () => {
		const snapshot = async () => ({
			pageWatchers: (
				await pool.query(
					"select source_id, user_id from page_watchers where page_id in (select id from pages where source_id = $1) order by source_id",
					[pageId],
				)
			).rows,
			spaceWatchers: (
				await pool.query(
					"select source_id, user_id from space_watchers where space_id in (select id from spaces where key = $1) order by source_id",
					[spaceKey],
				)
			).rows,
			pageLikes: (
				await pool.query(
					"select source_id, user_id from page_likes where page_id in (select id from pages where source_id = $1) order by source_id",
					[pageId],
				)
			).rows,
		});
		const before = await snapshot();
		expect(before.pageWatchers).not.toHaveLength(0);
		expect(before.spaceWatchers).not.toHaveLength(0);
		expect(before.pageLikes).not.toHaveLength(0);

		const result = await importWikiDataset(dataset, { baseUrl });
		expect(result.counts.page_watchers).toBeUndefined();
		expect(result.counts.space_watchers).toBeUndefined();
		expect(result.counts.page_likes).toBeUndefined();
		expect(await snapshot()).toEqual(before);
	});

	test("removes imported rows gone in Confluence and keeps application rows", async () => {
		const { rows: pageRowsResult } = await pool.query<{ id: string }>(
			"select id from pages where source_id = $1",
			[pageId],
		);
		const page = pageRowsResult[0];
		const [appUser] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.username, "fixture-social-app"));
		if (!page || !appUser) throw new Error("fixture rows were not imported");
		await db.insert(pageWatchers).values({
			pageId: page.id,
			userId: appUser.id,
		});

		const social = initialSocial();
		social.pageWatchers[pageId] = [
			{
				name: "fixture-social-one",
				fullName: "Fixture Social One",
				userKey: "uk-one",
			},
		];
		social.pageWatchers[childId] = [];
		social.spaceWatchers = [
			{
				name: "fixture-social-one",
				fullName: "Fixture Social One",
				userKey: "uk-one",
			},
		];
		social.likes = { [pageId]: [], [childId]: [] };
		const changed = await fetchFixture(social);
		const result = await importWikiDataset(changed, {
			baseUrl,
			privateApis: true,
		});
		expect(result.counts.page_watchers).toEqual({
			inserted: 0,
			updated: 0,
			unchanged: 1,
		});
		expect(result.counts.space_watchers).toEqual({
			inserted: 0,
			updated: 0,
			unchanged: 1,
		});
		expect(result.counts.page_likes).toEqual({
			inserted: 0,
			updated: 0,
			unchanged: 0,
		});

		const watcherRows = await pool.query<{
			username: string;
			source_id: string | null;
		}>(
			`select users.username, watcher.source_id
			 from page_watchers watcher
			 join users on users.id = watcher.user_id
			 where watcher.page_id = $1
			 order by users.username`,
			[page.id],
		);
		expect(watcherRows.rows).toEqual([
			{ username: "fixture-social-app", source_id: null },
			{ username: "fixture-social-one", source_id: expect.any(String) },
		]);
		const likes = await pool.query<{ count: number }>(
			"select count(*)::int as count from page_likes where page_id = $1",
			[page.id],
		);
		expect(likes.rows[0]?.count).toBe(0);
		const spaceRows = await pool.query<{ count: number }>(
			`select count(*)::int as count
			 from space_watchers watcher
			 join spaces on spaces.id = watcher.space_id
			 where spaces.key = $1`,
			[spaceKey],
		);
		expect(spaceRows.rows[0]?.count).toBe(1);
	});

	test("an unexpected response shape does not delete imported rows", async () => {
		const snapshot = async () => ({
			pageWatchers: (
				await pool.query(
					"select source_id, user_id from page_watchers where page_id in (select id from pages where source_id = $1) order by source_id",
					[pageId],
				)
			).rows,
			spaceWatchers: (
				await pool.query(
					"select source_id, user_id from space_watchers where space_id in (select id from spaces where key = $1) order by source_id",
					[spaceKey],
				)
			).rows,
			pageLikes: (
				await pool.query(
					"select source_id, user_id from page_likes where page_id in (select id from pages where source_id = $1) order by source_id",
					[pageId],
				)
			).rows,
		});
		const before = await snapshot();
		expect(before.pageWatchers).not.toHaveLength(0);
		expect(before.spaceWatchers).not.toHaveLength(0);

		const { client } = clientFor(initialSocial(), { badShape: true });
		const bad = await fetchWikiDataset(client, {
			attachmentsDir: "/tmp",
			skipAttachments: true,
			privateApis: true,
		});
		await importWikiDataset(bad, { baseUrl, privateApis: true });

		expect(await snapshot()).toEqual(before);
	});

	test("an unexpected response shape is logged once with its keys, not values", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { client } = clientFor(initialSocial(), { badShape: true });
		const bad = await fetchWikiDataset(client, {
			attachmentsDir: "/tmp",
			skipAttachments: true,
			privateApis: true,
		});
		expect(bad.socialShapeKeys).toEqual(new Set(["likes", "unexpected"]));
		expect(warn).toHaveBeenCalledTimes(1);
		const message = String(warn.mock.calls[0]?.[0]);
		expect(message).toContain("unexpected");
		expect(message).toContain("likes");
		expect(message).not.toContain("secret-value");
		warn.mockRestore();
	});
});
