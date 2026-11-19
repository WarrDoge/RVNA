import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/importer/db.ts";
import { importWikiDataset } from "../src/importer/wiki-import.ts";
import type { WikiPage, WikiSpaceData } from "../src/importer/wiki-types.ts";
import { pages } from "../src/lib/server/schema-wiki.ts";

const baseUrl = "https://confluence.example.test";

function page(
	sourceId: string,
	spaceKey: string,
	title: string,
	view: string,
): WikiPage {
	return {
		sourceId,
		spaceKey,
		parentSourceId: null,
		position: 0,
		title,
		type: "page",
		status: "current",
		versionNumber: 1,
		storage: `<p>${title}</p>`,
		view,
		creatorUserKey: null,
		created: new Date("2026-01-01T10:00:00Z"),
		lastModifierUserKey: null,
		updated: new Date("2026-01-02T10:00:00Z"),
		versions: [],
		comments: [],
		attachments: [],
		labels: [],
		restrictions: [],
		watchers: [],
		likes: [],
	};
}

function space(
	sourceId: string,
	key: string,
	pages: WikiPage[],
): WikiSpaceData {
	return {
		space: {
			sourceId,
			key,
			name: key,
			type: "global",
			status: "current",
			descriptionHtml: null,
			homePageSourceId: pages[0]?.sourceId ?? null,
			creatorUserKey: null,
			created: null,
			iconPath: null,
		},
		permissions: [],
		templates: [],
		pages,
		spaceWatchers: [],
	};
}

const firstSpace = space("cache-space-1", "C1", [
	page(
		"cache-page-1",
		"C1",
		"Home",
		'<p><a href="/display/C2/Target">Target</a></p>',
	),
]);
const secondSpace = space("cache-space-2", "C2", [
	page("cache-page-2", "C2", "Target", "<p>Target</p>"),
]);

async function homeBody() {
	const rows = await db
		.select({ bodyHtml: pages.bodyHtml })
		.from(pages)
		.where(eq(pages.sourceId, "cache-page-1"));
	return rows[0]?.bodyHtml ?? "";
}

beforeAll(async () => {
	await runMigrations();
	await pool.query("delete from spaces where key in ('C1', 'C2')");
	await importWikiDataset({ users: [], spaces: [firstSpace] }, { baseUrl });
});

afterAll(async () => {
	await pool.query("delete from spaces where key in ('C1', 'C2')");
	await pool.end();
});

describe("wiki rendered body cache", () => {
	test("re-renders an unchanged page when the link context grows", async () => {
		expect(await homeBody()).toContain("/display/C2/Target");

		await importWikiDataset(
			{ users: [], spaces: [firstSpace, secondSpace] },
			{ baseUrl },
		);

		const body = await homeBody();
		expect(body).toContain("/pages/viewpage.action?pageId=cache-page-2");
		expect(body).not.toContain("/display/C2/Target");
	});

	test("a page that moved to another space is updated, not inserted again", async () => {
		const moved = page("cache-page-1", "C2", "Home", "<p>Moved home</p>");
		const result = await importWikiDataset(
			{
				users: [],
				spaces: [
					{ ...firstSpace, pages: [] },
					space("cache-space-2", "C2", [
						secondSpace.pages[0] as WikiPage,
						moved,
					]),
				],
			},
			{ baseUrl },
		);
		expect(result.counts.pages?.inserted).toBe(0);
		const rows = await pool.query(
			"select s.key from pages p join spaces s on s.id = p.space_id where p.source_id = 'cache-page-1'",
		);
		expect(rows.rows).toEqual([{ key: "C2" }]);
	});

	test("releasing imported spaces empties their pages in the dataset", async () => {
		const dataset = {
			users: [],
			spaces: [
				space("cache-space-2", "C2", [secondSpace.pages[0] as WikiPage]),
			],
		};
		await importWikiDataset(dataset, { baseUrl, releaseSpaces: true });
		expect(dataset.spaces[0]?.pages).toEqual([]);
	});
});
