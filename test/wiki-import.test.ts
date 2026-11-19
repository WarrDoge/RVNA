import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { ConfluenceClient } from "../src/importer/confluence.ts";
import { db, pool, runMigrations } from "../src/importer/db.ts";
import { fetchWikiDataset } from "../src/importer/wiki-fetch.ts";
import { importWikiDataset } from "../src/importer/wiki-import.ts";
import { users } from "../src/lib/server/schema.ts";
import {
	pageAttachments,
	pageComments,
	pageLabels,
	pageRestrictions,
	pages,
	pageVersions,
	spacePermissions,
	spaces,
} from "../src/lib/server/schema-wiki.ts";
import { wikiFixture } from "./fixtures/wiki.ts";

const baseUrl = "https://confluence.example.test";

async function importFixture() {
	return importWikiDataset(wikiFixture(), { baseUrl, privateApis: true });
}

async function fixtureSpace() {
	const rows = await db.select().from(spaces).where(eq(spaces.key, "FIX"));
	const space = rows[0];
	if (!space) throw new Error("fixture space was not imported");
	return space;
}

async function fixturePage(sourceId: string) {
	const rows = await db
		.select()
		.from(pages)
		.where(and(eq(pages.sourceId, sourceId)));
	const page = rows[0];
	if (!page) throw new Error(`fixture page ${sourceId} was not imported`);
	return page;
}

function permissionClient(
	spaceKey: string,
	entries: unknown[],
	spaceId = "9001",
) {
	return {
		listUsers: async () => [],
		listSpaces: async (status: "current" | "archived") =>
			status === "current"
				? [
						{
							id: spaceId,
							key: spaceKey,
							name: "Permission mapping",
							type: "global",
							status: "current",
						},
					]
				: [],
		listSpacePermissions: async () => entries,
		listContent: async () => [],
	} as unknown as ConfluenceClient;
}

beforeAll(async () => {
	await runMigrations();
	await importFixture();
});

afterAll(async () => {
	await pool.end();
});

describe("wiki import", () => {
	test("keeps the page tree, ancestors and sibling order", async () => {
		const space = await fixtureSpace();
		const home = await fixturePage("100");
		const childOne = await fixturePage("101");
		const childTwo = await fixturePage("102");
		const draft = await fixturePage("103");
		const trashed = await fixturePage("104");
		const blogpost = await fixturePage("105");

		expect(space.homePageId).toBe(home.id);
		expect(home.spaceId).toBe(space.id);
		expect(home.parentId).toBeNull();
		expect(home.position).toBe(0);
		expect(childOne.parentId).toBe(home.id);
		expect(childTwo.parentId).toBe(home.id);
		expect(childOne.position).toBe(0);
		expect(childTwo.position).toBe(1);
		expect(draft.status).toBe("draft");
		expect(trashed.status).toBe("trashed");
		expect(blogpost.type).toBe("blogpost");

		const children = await db
			.select({ sourceId: pages.sourceId })
			.from(pages)
			.where(and(eq(pages.parentId, home.id)))
			.orderBy(asc(pages.position));
		expect(children.map((row) => row.sourceId)).toEqual(["101", "102", "103"]);
	});

	test("imports every historical version with its body", async () => {
		const home = await fixturePage("100");
		expect(home.versionNumber).toBe(2);

		const versions = await db
			.select()
			.from(pageVersions)
			.where(eq(pageVersions.pageId, home.id))
			.orderBy(asc(pageVersions.number));
		expect(versions.map((row) => row.number)).toEqual([1, 2]);
		expect(versions[0].bodyHtml).toContain("Home v1");
		expect(versions[0].minorEdit).toBe(true);
		expect(versions[1].minorEdit).toBe(false);
		expect(versions[1].message).toBe("rewritten");
		expect(versions[1].bodyHtml).toContain("/api/wiki/attachments/");
		expect(
			await db
				.select()
				.from(pageVersions)
				.where(eq(pageVersions.pageId, (await fixturePage("103")).id)),
		).toEqual([]);
	});

	test("separates page comments from inline comments and keeps threads", async () => {
		const home = await fixturePage("100");
		const rows = await db
			.select()
			.from(pageComments)
			.where(eq(pageComments.pageId, home.id));
		const bySource = new Map(rows.map((row) => [row.sourceId, row]));

		const root = bySource.get("200");
		const reply = bySource.get("201");
		const inline = bySource.get("202");
		const resolved = bySource.get("203");
		if (!root || !reply || !inline || !resolved) {
			throw new Error("fixture comments were not imported");
		}

		expect(root.inline).toBe(false);
		expect(reply.parentId).toBe(root.id);
		expect(inline.inline).toBe(true);
		expect(inline.inlineOriginalSelection).toBe("highlighted text");
		expect(inline.inlineMarkerRef).toBe("marker-202");
		expect(resolved.inline).toBe(true);
		expect(resolved.resolved).toBe(true);
	});

	test("imports restrictions, labels and space permissions", async () => {
		const home = await fixturePage("100");
		const alice = (
			await db.select().from(users).where(eq(users.username, "alice"))
		)[0];

		const restrictions = await db
			.select()
			.from(pageRestrictions)
			.where(eq(pageRestrictions.pageId, home.id));
		expect(restrictions).toHaveLength(2);
		expect(restrictions.find((row) => row.operation === "read")?.userId).toBe(
			alice.id,
		);
		expect(
			restrictions.find((row) => row.operation === "update")?.groupName,
		).toBe("confluence-admins");

		const labels = await db
			.select()
			.from(pageLabels)
			.where(eq(pageLabels.pageId, home.id));
		expect(labels.map((row) => row.label).sort()).toEqual(["howto", "spec"]);

		const space = await fixtureSpace();
		const permissions = await db
			.select()
			.from(spacePermissions)
			.where(eq(spacePermissions.spaceId, space.id));
		expect(permissions).toHaveLength(3);
		expect(permissions.filter((row) => row.anonymous)).toHaveLength(1);
		expect(
			permissions.find((row) => row.groupName === "confluence-users"),
		).toBeDefined();
	});

	test("rewrites attachment, page, mention and issue references in body_html", async () => {
		const home = await fixturePage("100");
		const alice = (
			await db.select().from(users).where(eq(users.username, "alice"))
		)[0];
		const attachmentRows = await db
			.select()
			.from(pageAttachments)
			.where(eq(pageAttachments.pageId, home.id));
		const latest = attachmentRows.find(
			(row) => row.fileName === "diagram.png" && row.version === 2,
		);
		if (!latest) throw new Error("fixture attachment was not imported");

		const html = home.bodyHtml ?? "";
		expect(html).toContain(`/api/wiki/attachments/${latest.id}`);
		expect(html).toContain('href="/pages/viewpage.action?pageId=102"');
		expect(html).toContain('href="/browse/ABC-12"');
		expect(html).toContain(`data-user-id="${alice.id}"`);
		expect(html).not.toContain("/display/");
		expect(html).not.toContain("src=confmacro");
		expect(home.bodyStorage).toContain('ac:name="jira"');
	});

	test("falls back to storage rendering for bodies without a view", async () => {
		const draft = await fixturePage("103");
		expect(draft.bodyHtml).toBe("<p>Draft Page</p>");
	});

	test("second run reports no inserts and no updates", async () => {
		const second = await importFixture();
		const changed = Object.entries(second.counts).filter(
			([, counts]) => counts.inserted > 0 || counts.updated > 0,
		);
		expect(changed).toEqual([]);
		expect(Object.keys(second.counts).sort()).toEqual([
			"page_attachments",
			"page_comments",
			"page_labels",
			"page_likes",
			"page_restrictions",
			"page_templates",
			"page_versions",
			"page_watchers",
			"pages",
			"space_permissions",
			"space_watchers",
			"spaces",
			"users",
		]);
	});

	test("maps space permissions by target type and removes stale imported rows", async () => {
		const spaceKey = `P${randomUUID().slice(0, 8).toUpperCase()}`;
		// A fresh source id each run, so a rerun on the same database starts from an empty space.
		const spaceId = String(
			9_000_000 + Number.parseInt(randomUUID().slice(0, 6), 16),
		);
		const entries = [
			{
				operation: { targetType: "comment", operationKey: "delete" },
				subject: { type: "group", name: "comment-only" },
			},
			{
				operation: { targetType: "attachment", operationKey: "delete" },
				subject: { type: "group", name: "attachment-only" },
			},
			{
				operation: { targetType: "comment", operationKey: "create" },
				subject: { type: "group", name: "comment-creators" },
			},
			{
				operation: { targetType: "page", operationKey: "delete" },
				subject: { type: "group", name: "page-delete" },
			},
			{
				operation: { targetType: "page", operationKey: "create" },
				subject: { type: "group", name: "page-creators" },
			},
			{
				operation: { targetType: "space", operationKey: "read" },
				subject: { type: "group", name: "readers" },
			},
			{
				operation: { targetType: "space", operationKey: "administer" },
				subject: { type: "group", name: "admins" },
			},
		];
		const options = { attachmentsDir: "/tmp", skipAttachments: true };
		const dataset = await fetchWikiDataset(
			permissionClient(spaceKey, entries, spaceId),
			options,
		);
		expect(Object.fromEntries(dataset.skippedPermissions)).toEqual({
			"comment:create": 1,
			"comment:delete": 1,
			"attachment:delete": 1,
		});
		await importWikiDataset(dataset, { baseUrl });

		const [space] = await db
			.select()
			.from(spaces)
			.where(eq(spaces.key, spaceKey));
		if (!space) throw new Error("permission space was not imported");
		const imported = await db
			.select()
			.from(spacePermissions)
			.where(eq(spacePermissions.spaceId, space.id));
		const subjects = (rows: typeof imported, permission: string) =>
			rows
				.filter((row) => row.permission === permission)
				.map((row) => row.groupName)
				.sort();
		expect(subjects(imported, "delete")).toEqual(["page-delete"]);
		expect(subjects(imported, "create")).toEqual(["page-creators"]);
		expect(subjects(imported, "read")).toEqual(["readers"]);

		const appSource = `fat:${randomUUID()}`;
		await db.insert(spacePermissions).values([
			{
				sourceId: `${spaceKey}#permission:delete:group:stale`,
				spaceId: space.id,
				permission: "delete",
				groupName: "stale",
			},
			{
				sourceId: appSource,
				spaceId: space.id,
				permission: "delete",
				groupName: "app-added",
			},
		]);
		const second = await fetchWikiDataset(
			permissionClient(spaceKey, entries, spaceId),
			options,
		);
		await importWikiDataset(second, { baseUrl });
		const after = await db
			.select()
			.from(spacePermissions)
			.where(eq(spacePermissions.spaceId, space.id));
		expect(after.find((row) => row.groupName === "stale")).toBeUndefined();
		expect(after.find((row) => row.sourceId === appSource)).toBeDefined();
		expect(subjects(after, "delete")).toEqual(["app-added", "page-delete"]);

		const empty = await fetchWikiDataset(
			permissionClient(spaceKey, [], spaceId),
			options,
		);
		await importWikiDataset(empty, { baseUrl });
		const kept = await db
			.select()
			.from(spacePermissions)
			.where(eq(spacePermissions.spaceId, space.id));
		expect(kept.length).toBe(after.length);
	});
});
