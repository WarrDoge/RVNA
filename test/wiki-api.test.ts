import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { HttpError } from "../src/lib/server/http.ts";
import {
	pageAttachments,
	pageComments,
	pageLabels,
	pageRestrictions,
	pages,
	pageVersions,
	spacePermissions,
	spaces,
	users,
} from "../src/lib/server/schema.ts";
import {
	addPageLabel,
	uploadPageAttachments,
} from "../src/lib/server/wiki/service.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const restrictedKey = `WA${run.slice(0, 3).toUpperCase()}`;
const openKey = `WB${run.slice(0, 3).toUpperCase()}`;
const readerGroup = `t-${run}-readers`;
const specialTitle = "Q&A / test (v2) + more";

let app: TestApp;
let alice: string;
let bob: string;
let carol: string;
let admin: string;
let restrictedSpace: typeof spaces.$inferSelect;
let openSpace: typeof spaces.$inferSelect;
let home: typeof pages.$inferSelect;
let childOne: typeof pages.$inferSelect;
let childTwo: typeof pages.$inferSelect;
let grandChild: typeof pages.$inferSelect;
let restrictedPage: typeof pages.$inferSelect;
let restrictedChild: typeof pages.$inferSelect;
let specialPage: typeof pages.$inferSelect;
let duplicateInOpenSpace: typeof pages.$inferSelect;
let _searchTitlePage: typeof pages.$inferSelect;
let _searchBodyPage: typeof pages.$inferSelect;
let attachmentId: string;

async function actorNamed(
	name: string,
	groups: string[],
): Promise<CurrentUser> {
	const [row] = await db
		.select()
		.from(users)
		.where(eq(users.username, `t-${run}-${name}`))
		.limit(1);
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		email: row.email,
		avatarUrl: null,
		groups,
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};
}

function cookie(sessionId: string) {
	return { sid: sessionId };
}

async function get(path: string, sessionId: string) {
	const response = await app.inject({
		method: "GET",
		url: path,
		cookies: cookie(sessionId),
	});
	return response;
}

async function send(
	method: "POST" | "PATCH" | "DELETE",
	path: string,
	sessionId: string,
	payload?: unknown,
) {
	return app.inject({
		method,
		url: path,
		cookies: cookie(sessionId),
		headers: { "x-requested-with": "rvna" },
		payload: payload as never,
	});
}

async function createPage(values: {
	spaceId: string;
	sourceId: string;
	title: string;
	parentId?: string | null;
	position?: number;
	bodyStorage?: string;
	bodyHtml?: string;
	creatorId?: string;
}) {
	const [row] = await db
		.insert(pages)
		.values({
			sourceId: values.sourceId,
			spaceId: values.spaceId,
			parentId: values.parentId ?? null,
			position: values.position ?? 0,
			title: values.title,
			status: "current",
			bodyStorage: values.bodyStorage ?? `<p>${values.title}</p>`,
			bodyHtml: values.bodyHtml ?? `<p>${values.title}</p>`,
			creatorId: values.creatorId ?? null,
			created: new Date(Date.UTC(2026, 0, 1)),
			updated: new Date(Date.UTC(2026, 0, 2)),
		})
		.returning();
	return row;
}

beforeAll(async () => {
	await runMigrations();
	await pool.query("delete from spaces where key = any($1)", [
		[restrictedKey, openKey],
	]);

	const [restricted] = await db
		.insert(spaces)
		.values({
			sourceId: `wa-space-${run}`,
			key: restrictedKey,
			name: `Restricted space ${run}`,
			type: "global",
		})
		.returning();
	restrictedSpace = restricted;
	const [open] = await db
		.insert(spaces)
		.values({
			sourceId: `wb-space-${run}`,
			key: openKey,
			name: `Open space ${run}`,
			type: "global",
		})
		.returning();
	openSpace = open;

	await db.insert(spacePermissions).values([
		{
			sourceId: `wb-read-${run}`,
			spaceId: openSpace.id,
			permission: "read",
			anonymous: true,
		},
		{
			sourceId: `wa-read-${run}`,
			spaceId: restrictedSpace.id,
			permission: "read",
			groupName: readerGroup,
		},
		{
			sourceId: `wa-create-${run}`,
			spaceId: restrictedSpace.id,
			permission: "create",
			groupName: readerGroup,
		},
		{
			sourceId: `wa-read-users-${run}`,
			spaceId: restrictedSpace.id,
			permission: "read",
			groupName: "confluence-users",
		},
	]);

	home = await createPage({
		spaceId: restrictedSpace.id,
		sourceId: `wa-${run}-home`,
		title: "Restricted Home",
		position: 0,
		bodyStorage:
			'<h1>Intro</h1><p>home body</p><ac:structured-macro ac:name="toc" />',
	});
	await db.update(pages).set({ versionNumber: 2 }).where(eq(pages.id, home.id));
	await db
		.update(spaces)
		.set({ homePageId: home.id })
		.where(eq(spaces.id, restrictedSpace.id));

	childOne = await createPage({
		spaceId: restrictedSpace.id,
		sourceId: `wa-${run}-child1`,
		title: "Child One",
		parentId: home.id,
		position: 0,
	});
	childTwo = await createPage({
		spaceId: restrictedSpace.id,
		sourceId: `wa-${run}-child2`,
		title: "Child Two",
		parentId: home.id,
		position: 1,
	});
	grandChild = await createPage({
		spaceId: restrictedSpace.id,
		sourceId: `wa-${run}-grandchild`,
		title: "Grandchild",
		parentId: childOne.id,
		position: 0,
	});
	restrictedPage = await createPage({
		spaceId: restrictedSpace.id,
		sourceId: `wa-${run}-restricted`,
		title: "Secret Plan",
		parentId: home.id,
		position: 2,
	});
	restrictedChild = await createPage({
		spaceId: restrictedSpace.id,
		sourceId: `wa-${run}-restricted-child`,
		title: "Secret Child",
		parentId: restrictedPage.id,
		position: 0,
	});
	specialPage = await createPage({
		spaceId: restrictedSpace.id,
		sourceId: `wa-${run}-special`,
		title: specialTitle,
		parentId: home.id,
		position: 3,
	});

	duplicateInOpenSpace = await createPage({
		spaceId: openSpace.id,
		sourceId: `wb-${run}-special`,
		title: specialTitle,
	});

	_searchTitlePage = await createPage({
		spaceId: openSpace.id,
		sourceId: `wb-${run}-zebra-title`,
		title: `Zebra widget ${run}`,
		bodyHtml: "<p>nothing here</p>",
		bodyStorage: "<p>nothing here</p>",
	});
	_searchBodyPage = await createPage({
		spaceId: openSpace.id,
		sourceId: `wb-${run}-zebra-body`,
		title: `Body page ${run}`,
		bodyHtml: `<p>a zebra widget ${run} in the body</p>`,
		bodyStorage: `<p>a zebra widget ${run} in the body</p>`,
	});

	await db.insert(pageRestrictions).values({
		sourceId: `wa-restriction-${run}`,
		pageId: restrictedPage.id,
		operation: "read",
		userId: null,
		groupName: readerGroup,
	});

	await db.insert(pageLabels).values({
		sourceId: `wa-label-${run}`,
		pageId: home.id,
		label: `featured-${run}`,
	});

	await db.insert(pageVersions).values([
		{
			sourceId: `wa-version-1-${run}`,
			pageId: home.id,
			number: 1,
			title: "Restricted Home",
			bodyStorage: "<p>the old body</p>",
			bodyHtml: "<p>the old body</p>",
			created: new Date(Date.UTC(2026, 0, 1)),
			message: "first",
		},
		{
			sourceId: `wa-version-2-${run}`,
			pageId: home.id,
			number: 2,
			title: "Restricted Home",
			bodyStorage: "<p>the new body</p>",
			bodyHtml: "<p>the new body</p>",
			created: new Date(Date.UTC(2026, 0, 3)),
			message: "second",
		},
	]);

	const storagePath = `wiki-${run}/home`;
	const directory = join(process.env.ATTACHMENTS_DIR as string, `wiki-${run}`);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "home"), "version two");
	const [attachment] = await db
		.insert(pageAttachments)
		.values([
			{
				sourceId: `wa-attachment-1-${run}`,
				pageId: home.id,
				fileName: "notes.txt",
				mimeType: "text/plain",
				size: 6,
				version: 1,
				storagePath,
				sha256: `wiki-${run}`,
			},
			{
				sourceId: `wa-attachment-2-${run}`,
				pageId: home.id,
				fileName: "notes.txt",
				mimeType: "text/plain",
				size: 11,
				version: 2,
				storagePath,
				sha256: `wiki-${run}`,
			},
		])
		.returning();
	attachmentId = attachment.id;

	await db.insert(pageComments).values([
		{
			sourceId: `wa-comment-1-${run}`,
			pageId: home.id,
			bodyHtml: "<p>first comment</p>",
			created: new Date(Date.UTC(2026, 0, 4)),
		},
		{
			sourceId: `wa-comment-2-${run}`,
			pageId: home.id,
			bodyHtml: "<p>inline comment</p>",
			inline: true,
			inlineMarkerRef: "marker-1",
			inlineOriginalSelection: "home body",
			created: new Date(Date.UTC(2026, 0, 5)),
		},
	]);

	app = buildServer();
	const aliceSession = await login(app, {
		sub: `sub-${run}-alice`,
		username: `t-${run}-alice`,
		name: `Alice ${run}`,
		groups: [readerGroup, "confluence-users"],
	});
	alice = aliceSession.sessionId as string;
	const carolSession = await login(app, {
		sub: `sub-${run}-carol`,
		username: `t-${run}-carol`,
		name: `Carol ${run}`,
		groups: ["confluence-users"],
	});
	carol = carolSession.sessionId as string;
	const bobSession = await login(app, {
		sub: `sub-${run}-bob`,
		username: `t-${run}-bob`,
		name: `Bob ${run}`,
		groups: [],
	});
	bob = bobSession.sessionId as string;
	const [bobRow] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.username, `t-${run}-bob`))
		.limit(1);
	await db.insert(spacePermissions).values({
		sourceId: `wb-create-bob-${run}`,
		spaceId: openSpace.id,
		permission: "create",
		userId: bobRow?.id ?? null,
	});
	const adminSession = await login(app, {
		sub: `sub-${run}-admin`,
		username: `t-${run}-admin`,
		name: `Admin ${run}`,
		groups: [adminGroup()],
	});
	admin = adminSession.sessionId as string;
});

function adminGroup() {
	const group = (globalThis as { adminGroup?: string }).adminGroup;
	if (!group) throw new Error("Admin group is not configured");
	return group;
}

afterAll(async () => {
	await pool.query("delete from spaces where key = any($1)", [
		[restrictedKey, openKey],
	]);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

describe("space listing", () => {
	test("hides a space from a user without its read permission", async () => {
		const response = await get("/api/wiki/spaces", bob);
		expect(response.statusCode).toBe(200);
		const keys = (response.json() as { key: string }[]).map((row) => row.key);
		expect(keys).toContain(openKey);
		expect(keys).not.toContain(restrictedKey);
	});

	test("shows the space to a member of the read group and to administrators", async () => {
		for (const session of [alice, carol, admin]) {
			const response = await get("/api/wiki/spaces", session);
			const keys = (response.json() as { key: string }[]).map((row) => row.key);
			expect(keys).toContain(restrictedKey);
			expect(keys).toContain(openKey);
		}
	});

	test("a space without permission rows is listed to administrators only", async () => {
		const key = `WC${run.slice(0, 3).toUpperCase()}`;
		await db.insert(spaces).values({
			sourceId: `wc-space-${run}`,
			key,
			name: `Bare space ${run}`,
			type: "global",
		});
		try {
			for (const [session, listed] of [
				[bob, false],
				[alice, false],
				[admin, true],
			] as const) {
				const response = await get("/api/wiki/spaces", session);
				const keys = (response.json() as { key: string }[]).map(
					(row) => row.key,
				);
				expect(keys.includes(key)).toBe(listed);
			}
		} finally {
			await pool.query("delete from spaces where key = $1", [key]);
		}
	});

	test("rejects anonymous requests", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/api/wiki/spaces",
		});
		expect(response.statusCode).toBe(401);
	});
});

describe("page lookup by old URL shapes", () => {
	test("resolves the imported source id and the uuid", async () => {
		const bySource = await get(`/api/wiki/pages/${home.sourceId}`, alice);
		expect(bySource.statusCode).toBe(200);
		expect((bySource.json() as { id: string }).id).toBe(home.id);

		const byId = await get(`/api/wiki/pages/${home.id}`, alice);
		expect(byId.statusCode).toBe(200);
		expect((byId.json() as { sourceId: string }).sourceId).toBe(home.sourceId);
	});

	test("resolves a title with special characters", async () => {
		const response = await get(
			`/api/wiki/resolve?spaceKey=${restrictedKey}&title=${encodeURIComponent(specialTitle)}`,
			alice,
		);
		expect(response.statusCode).toBe(200);
		expect((response.json() as { sourceId: string }).sourceId).toBe(
			specialPage.sourceId,
		);
	});

	test("resolves duplicate titles to the page of the named space", async () => {
		const inRestricted = await get(
			`/api/wiki/resolve?spaceKey=${restrictedKey}&title=${encodeURIComponent(specialTitle)}`,
			alice,
		);
		const inOpen = await get(
			`/api/wiki/resolve?spaceKey=${openKey}&title=${encodeURIComponent(specialTitle)}`,
			alice,
		);
		expect((inRestricted.json() as { id: string }).id).toBe(specialPage.id);
		expect((inOpen.json() as { id: string }).id).toBe(duplicateInOpenSpace.id);
	});

	test("returns 404 for an unknown title", async () => {
		const response = await get(
			`/api/wiki/resolve?spaceKey=${openKey}&title=nope-${run}`,
			bob,
		);
		expect(response.statusCode).toBe(404);
	});
});

describe("page tree", () => {
	test("lists children in imported position order", async () => {
		const response = await get(
			`/api/wiki/pages/${home.sourceId}/children`,
			alice,
		);
		expect(response.statusCode).toBe(200);
		const children = response.json() as { id: string; hasChildren: boolean }[];
		expect(children.map((row) => row.id)).toEqual([
			childOne.id,
			childTwo.id,
			restrictedPage.id,
			specialPage.id,
		]);
		expect(children[0]?.hasChildren).toBe(true);
		expect(children[1]?.hasChildren).toBe(false);
	});

	test("exposes the grandchild only under its parent", async () => {
		const response = await get(
			`/api/wiki/pages/${childOne.sourceId}/children`,
			alice,
		);
		const children = response.json() as { id: string }[];
		expect(children.map((row) => row.id)).toEqual([grandChild.id]);
	});

	test("the space tree starts at the home page", async () => {
		const response = await get(`/api/wiki/spaces/${restrictedKey}/tree`, alice);
		const roots = response.json() as { id: string }[];
		expect(roots.map((row) => row.id)).toEqual([home.id]);
	});
});

describe("permission enforcement", () => {
	test("hides a restricted page and its descendants from other users", async () => {
		for (const page of [restrictedPage, restrictedChild]) {
			expect(
				(await get(`/api/wiki/pages/${page.sourceId}`, alice)).statusCode,
			).toBe(200);
			expect(
				(await get(`/api/wiki/pages/${page.sourceId}`, carol)).statusCode,
			).toBe(404);
			expect(
				(await get(`/api/wiki/pages/${page.sourceId}`, bob)).statusCode,
			).toBe(404);
			expect(
				(await get(`/api/wiki/pages/${page.sourceId}`, admin)).statusCode,
			).toBe(200);
		}
	});

	test("hides the restricted branch from the children list", async () => {
		const response = await get(
			`/api/wiki/pages/${home.sourceId}/children`,
			carol,
		);
		expect(response.statusCode).toBe(200);
		const ids = (response.json() as { id: string }[]).map((row) => row.id);
		expect(ids).not.toContain(restrictedPage.id);
		expect(ids).toContain(childOne.id);
	});

	test("hides a restricted page from search results", async () => {
		const response = await get("/api/wiki/search?query=Secret", carol);
		const titles = (response.json() as { hits: { title: string }[] }).hits.map(
			(row) => row.title,
		);
		expect(titles).not.toContain("Secret Plan");
		expect(titles).not.toContain("Secret Child");

		const asAlice = await get("/api/wiki/search?query=Secret", alice);
		const aliceTitles = (
			asAlice.json() as { hits: { title: string }[] }
		).hits.map((row) => row.title);
		expect(aliceTitles).toContain("Secret Plan");
	});

	test("refuses attachment downloads from an unreadable space", async () => {
		const url = `/download/attachments/${home.sourceId}/notes.txt`;
		const anonymous = await app.inject({ method: "GET", url });
		expect(anonymous.statusCode).toBe(302);
		expect(anonymous.headers.location).toMatch(/^\/auth\/login\?returnTo=/);

		expect((await get(url, bob)).statusCode).toBe(404);
		expect((await get(url, carol)).statusCode).toBe(200);
		const allowed = await get(url, alice);
		expect(allowed.statusCode).toBe(200);
		expect(allowed.body).toBe("version two");
	});

	test("a signed-out HEAD is a 401, only a GET goes to the sign-in form", async () => {
		for (const url of [
			`/download/attachments/${home.sourceId}/notes.txt`,
			`/download/thumbnails/${home.sourceId}/notes.txt`,
		]) {
			const head = await app.inject({ method: "HEAD", url });
			expect(head.statusCode, url).toBe(401);
			expect(head.headers.location, url).toBeUndefined();
			const getAnonymous = await app.inject({ method: "GET", url });
			expect(getAnonymous.statusCode, url).toBe(302);
		}
	});

	test("user avatars in wiki responses go through the app route, never a stored external URL", async () => {
		await pool.query(
			"update users set avatar_url = 'https://avatars.example.test/a.png' where username like $1",
			[`t-${run}-%`],
		);
		for (const url of [
			`/api/wiki/pages/${home.sourceId}`,
			`/api/wiki/pages/${home.sourceId}/attachments`,
			`/api/wiki/pages/${home.sourceId}/versions`,
			`/api/wiki/pages/${home.sourceId}/comments`,
			`/api/wiki/edit/pages/${home.sourceId}`,
		]) {
			const response = await get(url, admin);
			expect(response.statusCode, url).toBe(200);
			expect(response.body, url).not.toContain("avatars.example.test");
		}
	});

	test("serves a named attachment version", async () => {
		const response = await get(
			`/download/attachments/${home.sourceId}/notes.txt?version=1`,
			alice,
		);
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-disposition"]).toContain("inline");
	});

	test("refuses page versions and comments of a restricted page", async () => {
		expect(
			(await get(`/api/wiki/pages/${restrictedPage.sourceId}/versions`, carol))
				.statusCode,
		).toBe(404);
		expect(
			(await get(`/api/wiki/pages/${restrictedPage.sourceId}/comments`, carol))
				.statusCode,
		).toBe(404);
	});
});

describe("page detail", () => {
	test("returns breadcrumbs, children, labels, attachments and comments", async () => {
		const response = await get(`/api/wiki/pages/${home.sourceId}`, alice);
		expect(response.statusCode).toBe(200);
		const page = response.json() as {
			bodyHtml: string;
			children: { id: string }[];
			labels: { label: string }[];
			attachments: { fileName: string; versions: unknown[] }[];
			comments: { inline: boolean }[];
			space: { key: string };
			ancestors: unknown[];
		};
		expect(page.bodyHtml).toContain('class="wiki-toc"');
		expect(page.children.length).toBe(4);
		expect(page.labels.map((row) => row.label)).toContain(`featured-${run}`);
		expect(page.attachments[0]?.fileName).toBe("notes.txt");
		expect(page.attachments[0]?.versions.length).toBe(2);
		expect(page.comments.length).toBe(2);
		expect(page.comments[1]?.inline).toBe(true);
		expect(page.space.key).toBe(restrictedKey);
	});

	test("returns ancestors for a nested page", async () => {
		const response = await get(`/api/wiki/pages/${grandChild.sourceId}`, alice);
		const page = response.json() as { ancestors: { id: string }[] };
		expect(page.ancestors.map((row) => row.id)).toEqual([home.id, childOne.id]);
	});
});

describe("versions and diff", () => {
	test("lists versions with the current one marked", async () => {
		const response = await get(
			`/api/wiki/pages/${home.sourceId}/versions`,
			alice,
		);
		const versions = response.json() as { number: number; current: boolean }[];
		expect(versions.length).toBe(2);
		expect(versions[0]?.number).toBe(2);
	});

	test("renders an old version", async () => {
		const response = await get(
			`/api/wiki/pages/${home.sourceId}/versions/1`,
			alice,
		);
		const version = response.json() as { bodyHtml: string; current: boolean };
		expect(version.bodyHtml).toContain("the old body");
		expect(version.current).toBe(false);
	});

	test("diffs two versions word by word", async () => {
		const response = await get(
			`/api/wiki/pages/${home.sourceId}/diff?from=1&to=2`,
			alice,
		);
		expect(response.statusCode).toBe(200);
		const diff = response.json() as { blocks: { html: string }[] };
		const html = diff.blocks.map((block) => block.html).join("");
		expect(html).toContain("wiki-diff-removed");
		expect(html).toContain("wiki-diff-added");
		expect(html).toContain("old");
		expect(html).toContain("new");
	});
});

describe("comments", () => {
	let rootComment: string;

	test("creates a thread, a reply and rejects editing someone else's comment", async () => {
		const created = await send(
			"POST",
			`/api/wiki/pages/${duplicateInOpenSpace.sourceId}/comments`,
			alice,
			{ bodyHtml: "<p>root comment</p>" },
		);
		expect(created.statusCode).toBe(201);
		rootComment = (created.json() as { id: string }).id;

		const reply = await send(
			"POST",
			`/api/wiki/pages/${duplicateInOpenSpace.sourceId}/comments`,
			bob,
			{ bodyHtml: "<p>a reply</p>", parentId: rootComment },
		);
		expect(reply.statusCode).toBe(201);

		const listed = await get(
			`/api/wiki/pages/${duplicateInOpenSpace.sourceId}/comments`,
			alice,
		);
		const comments = listed.json() as {
			id: string;
			parentId: string | null;
			canEdit: boolean;
		}[];
		const replyRow = comments.find((row) => row.parentId === rootComment);
		expect(replyRow).toBeDefined();
		expect(replyRow?.canEdit).toBe(false);

		const forbidden = await send(
			"PATCH",
			`/api/wiki/comments/${replyRow?.id}`,
			alice,
			{ bodyHtml: "<p>hijacked</p>" },
		);
		expect(forbidden.statusCode).toBe(403);

		const edited = await send(
			"PATCH",
			`/api/wiki/comments/${replyRow?.id}`,
			bob,
			{ bodyHtml: "<p>edited reply</p>" },
		);
		expect(edited.statusCode).toBe(200);
		expect((edited.json() as { bodyHtml: string }).bodyHtml).toContain(
			"edited reply",
		);
	});

	test("resolves and reopens an inline comment", async () => {
		const inline = await db
			.select()
			.from(pageComments)
			.where(eq(pageComments.pageId, home.id));
		const inlineComment = inline.find((row) => row.inline);
		expect(inlineComment).toBeDefined();

		const resolved = await send(
			"POST",
			`/api/wiki/comments/${inlineComment?.id}/resolve`,
			alice,
			{ resolved: true },
		);
		expect(resolved.statusCode).toBe(200);
		expect((resolved.json() as { resolved: boolean }).resolved).toBe(true);

		const reopened = await send(
			"POST",
			`/api/wiki/comments/${inlineComment?.id}/resolve`,
			alice,
			{ resolved: false },
		);
		expect((reopened.json() as { resolved: boolean }).resolved).toBe(false);
	});

	test("an administrator can delete any comment", async () => {
		const removed = await send(
			"DELETE",
			`/api/wiki/comments/${rootComment}`,
			admin,
		);
		expect(removed.statusCode).toBe(204);
	});
});

describe("attachments", () => {
	test("uploads a new file and then a new version of it", async () => {
		const boundary = "----fatwiki";
		function multipart(fileName: string, body: string) {
			return {
				payload: [
					`--${boundary}`,
					`Content-Disposition: form-data; name="file"; filename="${fileName}"`,
					"Content-Type: text/plain",
					"",
					body,
					`--${boundary}--`,
					"",
				].join("\r\n"),
				headers: {
					"content-type": `multipart/form-data; boundary=${boundary}`,
					"x-requested-with": "rvna",
				},
			};
		}

		const first = multipart("upload.txt", "hello");
		const readOnly = await app.inject({
			method: "POST",
			url: `/api/wiki/pages/${home.sourceId}/attachments`,
			cookies: cookie(carol),
			...first,
		});
		expect(readOnly.statusCode).toBe(403);
		const created = await app.inject({
			method: "POST",
			url: `/api/wiki/pages/${home.sourceId}/attachments`,
			cookies: cookie(alice),
			...first,
		});
		expect(created.statusCode).toBe(201);
		const uploaded = created.json() as { id: string; version: number }[];
		expect(uploaded[0]?.version).toBe(1);

		const second = multipart("upload.txt", "hello again");
		const again = await app.inject({
			method: "POST",
			url: `/api/wiki/pages/${home.sourceId}/attachments`,
			cookies: cookie(alice),
			...second,
		});
		expect(again.statusCode).toBe(201);
		const versioned = again.json() as { version: number }[];
		expect(versioned[0]?.version).toBe(2);

		const listed = await get(
			`/api/wiki/pages/${home.sourceId}/attachments`,
			alice,
		);
		const rows = listed.json() as { fileName: string; versions: unknown[] }[];
		const row = rows.find((candidate) => candidate.fileName === "upload.txt");
		expect(row?.versions.length).toBe(2);

		const download = await get(
			`/download/attachments/${home.sourceId}/upload.txt`,
			alice,
		);
		expect(download.body).toBe("hello again");
	});

	test("the upload function checks the page and the file cap itself", async () => {
		const file = {
			field: "file",
			path: join(tmpdir(), `missing-${run}`),
			fileName: "a.txt",
			mimeType: "text/plain",
			size: 1,
		};
		const refusal = async (
			actor: CurrentUser,
			pageId: string,
			files: (typeof file)[],
		) => {
			const error = await uploadPageAttachments(actor, pageId, {
				fields: {},
				files,
			}).then(
				() => null,
				(caught: unknown) => caught,
			);
			expect(error).toBeInstanceOf(HttpError);
			return error as HttpError;
		};

		const carolActor = await actorNamed("carol", ["confluence-users"]);
		expect((await refusal(carolActor, home.id, [file])).status).toBe(403);
		expect((await refusal(carolActor, randomUUID(), [file])).status).toBe(404);

		const aliceActor = await actorNamed("alice", [
			readerGroup,
			"confluence-users",
		]);
		const tooMany = await refusal(
			aliceActor,
			home.id,
			Array.from({ length: 21 }, () => ({ ...file })),
		);
		expect(tooMany.status).toBe(413);
		expect(tooMany.details).toMatchObject({ code: "FST_FILES_LIMIT" });
	});

	test("a failed upload batch leaves no attachment row without its file", async () => {
		const directory = await mkdtemp(join(tmpdir(), "rvna-upload-fail-"));
		const fileName = `partial-${run}.txt`;
		const goodPath = join(directory, "good.txt");
		await writeFile(goodPath, "good");
		const aliceActor = await actorNamed("alice", [
			readerGroup,
			"confluence-users",
		]);

		await expect(
			uploadPageAttachments(aliceActor, home.id, {
				fields: {},
				files: [
					{
						field: "file",
						path: goodPath,
						fileName,
						mimeType: "text/plain",
						size: 4,
					},
					{
						field: "file",
						path: join(directory, "missing.txt"),
						fileName: "missing.txt",
						mimeType: "text/plain",
						size: 1,
					},
				],
			}),
		).rejects.toThrow();

		const rows = await db
			.select()
			.from(pageAttachments)
			.where(eq(pageAttachments.fileName, fileName));
		expect(rows).toHaveLength(0);
		await rm(directory, { recursive: true, force: true });
	});

	test("an attachment id that is not a UUID is a 404, not a validation error", async () => {
		const response = await get("/api/wiki/attachments/not-an-id", alice);
		expect(response.statusCode).toBe(404);
		expect(response.json()).toEqual({ error: "Attachment not found" });
		const removal = await send(
			"DELETE",
			"/api/wiki/attachments/not-an-id",
			admin,
		);
		expect(removal.statusCode).toBe(400);
	});

	test("a repeated inline or version key still downloads", async () => {
		const url = `/download/attachments/${home.sourceId}/notes.txt`;
		const versions = await get(`${url}?version=1&version=2`, alice);
		expect(versions.statusCode).toBe(200);
		expect(versions.body).toBe("version two");

		const inline = await get(`${url}?inline=1&inline=0`, alice);
		expect(inline.statusCode).toBe(200);
		expect(inline.headers["content-disposition"]).toContain("attachment");
		const byId = await get(
			`/api/wiki/attachments/${attachmentId}?inline=1&inline=0`,
			alice,
		);
		expect(byId.statusCode).toBe(200);
		expect(byId.headers["content-disposition"]).toContain("attachment");
	});

	test("deleting one version keeps a file that another version still uses", async () => {
		const response = await send(
			"DELETE",
			`/api/wiki/attachments/${attachmentId}`,
			admin,
		);
		expect(response.statusCode).toBe(204);
		const remaining = await get(
			`/download/attachments/${home.sourceId}/notes.txt`,
			alice,
		);
		expect(remaining.statusCode).toBe(200);
		expect(remaining.body).toBe("version two");

		const [last] = await db
			.select({ id: pageAttachments.id })
			.from(pageAttachments)
			.where(eq(pageAttachments.pageId, home.id));
		expect(
			(await send("DELETE", `/api/wiki/attachments/${last?.id}`, admin))
				.statusCode,
		).toBe(204);
		expect(
			(await get(`/download/attachments/${home.sourceId}/notes.txt`, alice))
				.statusCode,
		).toBe(404);
	});
});

describe("labels, watch and like", () => {
	test("adds and removes a label", async () => {
		const added = await send(
			"POST",
			`/api/wiki/pages/${duplicateInOpenSpace.sourceId}/labels`,
			bob,
			{ label: `New-${run}` },
		);
		expect(added.statusCode).toBe(201);
		const label = added.json() as { id: string; label: string };
		expect(label.label).toBe(`new-${run}`);

		const again = await send(
			"POST",
			`/api/wiki/pages/${duplicateInOpenSpace.sourceId}/labels`,
			bob,
			{ label: `New-${run}` },
		);
		expect(again.statusCode).toBe(200);
		expect(again.json()).toEqual(label);

		const removed = await send("DELETE", `/api/wiki/labels/${label.id}`, bob);
		expect(removed.statusCode).toBe(204);
	});

	test("addPageLabel returns the label in the API shape", async () => {
		const bobActor = await actorNamed("bob", []);
		const label = await addPageLabel(
			bobActor,
			duplicateInOpenSpace.sourceId,
			`Shape-${run}`,
		);
		expect(Object.keys(label).sort()).toEqual(["id", "label"]);
		expect(label.label).toBe(`shape-${run}`);
		await pool.query("delete from page_labels where id = $1", [label.id]);
	});

	test("toggles watch and like", async () => {
		const watched = await send(
			"POST",
			`/api/wiki/pages/${home.sourceId}/watch`,
			alice,
			{ watching: true },
		);
		expect((watched.json() as { watching: boolean }).watching).toBe(true);
		const unwatched = await send(
			"POST",
			`/api/wiki/pages/${home.sourceId}/watch`,
			alice,
			{ watching: false },
		);
		expect((unwatched.json() as { watching: boolean }).watching).toBe(false);

		const liked = await send(
			"POST",
			`/api/wiki/pages/${home.sourceId}/like`,
			alice,
		);
		expect((liked.json() as { liked: boolean }).liked).toBe(true);
		const unliked = await send(
			"POST",
			`/api/wiki/pages/${home.sourceId}/like`,
			alice,
		);
		expect((unliked.json() as { liked: boolean }).liked).toBe(false);
	});
});

describe("search", () => {
	test("ranks a title match above a body match", async () => {
		const response = await get(
			`/api/wiki/search?query=${encodeURIComponent(`zebra widget ${run}`)}`,
			bob,
		);
		const hits = (response.json() as { hits: { title: string }[] }).hits;
		expect(hits.length).toBeGreaterThanOrEqual(2);
		expect(hits[0]?.title).toBe(`Zebra widget ${run}`);
		expect(hits.map((hit) => hit.title)).toContain(`Body page ${run}`);
	});

	test("filters by space", async () => {
		await createPage({
			spaceId: restrictedSpace.id,
			sourceId: `wa-${run}-search-filter`,
			title: `Restricted search ${run}`,
		});
		const response = await get(
			`/api/wiki/search?query=${encodeURIComponent(run)}&space=${openKey}`,
			alice,
		);
		const hits = (response.json() as { hits: { spaceKey: string }[] }).hits;
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.every((hit) => hit.spaceKey === openKey)).toBe(true);
		expect(hits.some((hit) => hit.spaceKey === restrictedKey)).toBe(false);
	});

	test("highlights the matching term in the excerpt", async () => {
		const response = await get(
			`/api/wiki/search?query=${encodeURIComponent(`zebra widget ${run}`)}`,
			bob,
		);
		const hits = (response.json() as { hits: { excerpt: string }[] }).hits;
		const bodyHit = hits.find((hit) => hit.excerpt.includes("<mark>"));
		expect(bodyHit).toBeDefined();
	});

	test("suggests page titles for the top bar", async () => {
		const response = await get(
			`/api/wiki/search/suggest?query=${encodeURIComponent("Zebra")}`,
			bob,
		);
		const suggestions = response.json() as { title: string }[];
		expect(suggestions[0]?.title).toBe(`Zebra widget ${run}`);
	});
});

describe("home and labels", () => {
	test("returns recent pages, spaces and the user's pages", async () => {
		const response = await get("/api/wiki/home", alice);
		expect(response.statusCode).toBe(200);
		const home = response.json() as {
			recent: { title: string }[];
			spaces: { key: string }[];
		};
		expect(home.spaces.map((row) => row.key)).toContain(restrictedKey);
		expect(home.recent.length).toBeGreaterThan(0);
	});

	test("lists pages by label", async () => {
		const response = await get(`/api/wiki/labels/featured-${run}`, alice);
		const rows = response.json() as { id: string }[];
		expect(rows.map((row) => row.id)).toContain(home.id);

		const hidden = await get(`/api/wiki/labels/featured-${run}`, bob);
		expect((hidden.json() as { id: string }[]).length).toBe(0);
	});
});

describe("wiki editor validation", () => {
	test("answers the first issue with its dotted path", async () => {
		const invalidLabel = await app.inject({
			method: "PUT",
			url: `/api/wiki/pages/${duplicateInOpenSpace.id}/labels`,
			cookies: cookie(bob),
			headers: { "x-requested-with": "rvna" },
			payload: { labels: [123] },
		});
		expect(invalidLabel.statusCode).toBe(400);
		expect(invalidLabel.json().error).toMatch(/^labels\.0: /);

		const invalidId = await get(
			"/api/wiki/edit/pages/not-a-uuid/restrictions",
			bob,
		);
		expect(invalidId.statusCode).toBe(400);
		expect(invalidId.json().error).toMatch(/^id: /);
	});

	test("rejects a malformed body on a mutating route without a body schema", async () => {
		const response = await app.inject({
			method: "POST",
			url: `/api/wiki/pages/${duplicateInOpenSpace.id}/trash`,
			cookies: cookie(bob),
			headers: {
				"x-requested-with": "rvna",
				"content-type": "application/json",
			},
			payload: "{",
		});
		expect(response.statusCode).toBe(400);
		expect(response.json().code).toBe("FST_ERR_CTP_INVALID_JSON_BODY");
	});
});
