import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool } from "../src/lib/server/db.ts";
import {
	pageAttachments,
	pageComments,
	pages,
	spaces,
} from "../src/lib/server/schema.ts";
import { loadWikiAccess } from "../src/lib/server/wiki/permissions.ts";
import { renderWikiBody } from "../src/lib/server/wiki/render.ts";
import { setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let other: TestSpace;
let actor: CurrentUser;

async function createPage(spaceId: string, title: string, bodyStorage: string) {
	const [row] = await db
		.insert(pages)
		.values({
			sourceId: `rct-${randomUUID()}`,
			spaceId,
			title,
			bodyStorage,
			bodyHtml: bodyStorage,
		})
		.returning();
	return row;
}

async function render(row: typeof pages.$inferSelect) {
	const access = await loadWikiAccess(actor);
	const [spaceRow] = await db
		.select()
		.from(spaces)
		.where(eq(spaces.id, row.spaceId))
		.limit(1);
	return renderWikiBody(
		{
			id: row.id,
			sourceId: row.sourceId,
			spaceId: row.spaceId,
			title: row.title,
			bodyStorage: row.bodyStorage,
			bodyHtml: row.bodyHtml,
		},
		{ user: actor, access, space: spaceRow },
	);
}

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("RCT");
	other = await wiki.space("RCX");
	actor = {
		id: wiki.admin.id,
		username: wiki.admin.username,
		displayName: "Wiki admin",
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: true,
		mustChangePassword: false,
		hasPassword: false,
	};
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

test("a render resolves links, attachments and inline markers together", async () => {
	const target = await createPage(space.id, "Context target", "<p>target</p>");
	const foreign = await createPage(
		other.id,
		"Context foreign",
		"<p>foreign</p>",
	);
	const host = await createPage(
		space.id,
		"Context host",
		[
			`<p><ac:link><ri:page ri:content-title="${target.title}" /></ac:link></p>`,
			`<p><ac:link><ri:page ri:space-key="" ri:content-title="${target.title}" /></ac:link></p>`,
			`<p><ac:link><ri:page ri:space-key="${other.key}" ri:content-title="${foreign.title}" /></ac:link></p>`,
			'<p><ac:link><ri:attachment ri:filename="notes.txt" /></ac:link></p>',
			'<p><ac:inline-comment-marker ac:ref="marker-1">marked</ac:inline-comment-marker></p>',
		].join(""),
	);
	const [attachment] = await db
		.insert(pageAttachments)
		.values({
			sourceId: `rct-${randomUUID()}`,
			pageId: host.id,
			fileName: "notes.txt",
			mimeType: "text/plain",
			size: 4,
			version: 1,
			storagePath: `rct-${randomUUID()}/notes.txt`,
			sha256: randomUUID(),
		})
		.returning();
	await db.insert(pageComments).values({
		sourceId: `rct-${randomUUID()}`,
		pageId: host.id,
		bodyHtml: "<p>comment</p>",
		inline: true,
		inlineMarkerRef: "marker-1",
	});

	const html = (await render(host)) ?? "";
	expect(html.split(`pageId=${target.sourceId}`)).toHaveLength(3);
	expect(html).toContain(`pageId=${foreign.sourceId}`);
	expect(html).toContain(
		`/download/attachments/${host.sourceId}/notes.txt?version=${attachment.version}`,
	);
	expect(html).toContain('data-marker="marker-1"');
	expect(html).toContain('data-known="1"');
});

test("a body with many distinct linked spaces still renders", async () => {
	const body = Array.from(
		{ length: 66_000 },
		(_, index) => `<ri:page ri:space-key="k${index}" />`,
	).join("");
	const host = await createPage(space.id, "Context many spaces", body);
	const html = await render(host);
	expect(html).not.toBeNull();
}, 20_000);
