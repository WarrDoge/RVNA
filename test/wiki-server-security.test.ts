import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { env } from "../src/lib/server/env.ts";
import {
	issues,
	issueTypes,
	pageAttachments,
	pageComments,
	pageLabels,
	pageRestrictions,
	pageVersions,
	permissionGrants,
	permissionSchemes,
	projects,
	spacePermissions,
	statuses,
	users,
} from "../src/lib/server/schema.ts";
import { pages, spaces } from "../src/lib/server/schema-wiki.ts";
import {
	latestAttachments,
	pageAttachmentVersions,
	pageContributors,
	visiblePages,
} from "../src/lib/server/wiki/data.ts";
import {
	type MacroContext,
	renderMacro,
} from "../src/lib/server/wiki/macros.ts";
import { loadWikiAccess } from "../src/lib/server/wiki/permissions.ts";
import { renderWikiBody } from "../src/lib/server/wiki/render.ts";
import {
	attachmentDownloadByName,
	deleteLabel,
	ensurePageLabel,
	getPage,
	getPageRestrictions,
	getSpace,
	listComments,
	listSpaces,
	searchPages,
	thumbnailDownload,
	wikiHome,
} from "../src/lib/server/wiki/service.ts";
import {
	decodeEntities,
	sanitizeWikiBody,
} from "../src/lib/server/wiki/storage.ts";
import { fileResponse } from "../src/routes/api/wiki/download.ts";

const run = randomUUID().slice(0, 8);
const spaceKey = `WS${run.slice(0, 4).toUpperCase()}`;
const secondKey = `WT${run.slice(0, 4).toUpperCase()}`;
const restrictedKey = `WU${run.slice(0, 4).toUpperCase()}`;
const readersGroup = `t-${run}-readers`;
const nobodyGroup = `t-${run}-nobody`;
const issueKey = `WSS${run.slice(0, 3).toUpperCase()}-1`;
const issueSummary = `Hidden issue ${run}`;

let space: typeof spaces.$inferSelect;
let secondSpace: typeof spaces.$inferSelect;
let restrictedSpace: typeof spaces.$inferSelect;
let reader: CurrentUser;
let editor: CurrentUser;
let nobody: CurrentUser;
let page: typeof pages.$inferSelect;
let bodyHtmlOnly: typeof pages.$inferSelect;
let stylePage: typeof pages.$inferSelect;
let iframePage: typeof pages.$inferSelect;
let linkHostPage: typeof pages.$inferSelect;
let hiddenPage: typeof pages.$inferSelect;
let jiraPage: typeof pages.$inferSelect;
let commentPage: typeof pages.$inferSelect;
let labelPage: typeof pages.$inferSelect;
let restrictionsPage: typeof pages.$inferSelect;
let restrictedHome: typeof pages.$inferSelect;
let secondPage: typeof pages.$inferSelect;
let recentHostPage: typeof pages.$inferSelect;
let entityPage: typeof pages.$inferSelect;
let existingLabelId: string;
let projectId: string;
let typeId: string;
let statusId: string;
const attachmentDir = join(env.ATTACHMENTS_DIR, `security-${run}`);

function actor(row: typeof users.$inferSelect, groups: string[]): CurrentUser {
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

async function createPage(input: {
	spaceId: string;
	title: string;
	bodyStorage: string | null;
	bodyHtml: string | null;
	updated?: Date;
}) {
	const [row] = await db
		.insert(pages)
		.values({
			sourceId: `ws-${randomUUID()}`,
			spaceId: input.spaceId,
			title: input.title,
			status: "current",
			bodyStorage: input.bodyStorage,
			bodyHtml: input.bodyHtml,
			creatorId: editor.id,
			created: new Date(Date.UTC(2026, 0, 1)),
			lastModifierId: editor.id,
			updated: input.updated ?? new Date(Date.UTC(2026, 0, 2)),
		})
		.returning();
	return row;
}

async function render(
	row: typeof pages.$inferSelect,
	who: CurrentUser,
	spaceRow: typeof spaces.$inferSelect = space,
) {
	const access = await loadWikiAccess(who);
	return renderWikiBody(
		{
			id: row.id,
			sourceId: row.sourceId,
			spaceId: row.spaceId,
			title: row.title,
			bodyStorage: row.bodyStorage,
			bodyHtml: row.bodyHtml,
		},
		{
			user: who,
			access,
			space: spaceRow,
			searchUser: { id: who.id, username: who.username },
		},
	);
}

async function attachment(input: {
	pageId: string;
	fileName: string;
	mimeType: string;
	storagePath: string;
	content: string;
}) {
	const filePath = join(env.ATTACHMENTS_DIR, input.storagePath);
	await mkdir(
		join(env.ATTACHMENTS_DIR, input.storagePath.split("/")[0] ?? ""),
		{
			recursive: true,
		},
	);
	await writeFile(filePath, input.content);
	await db.insert(pageAttachments).values({
		sourceId: `ws-att-${randomUUID()}`,
		pageId: input.pageId,
		fileName: input.fileName,
		mimeType: input.mimeType,
		size: input.content.length,
		version: 1,
		authorId: editor.id,
		created: new Date(Date.UTC(2026, 0, 1)),
		storagePath: input.storagePath,
		sha256: randomUUID(),
	});
	return filePath;
}

beforeAll(async () => {
	await runMigrations();
	await pool.query("delete from spaces where key = any($1)", [
		[spaceKey, secondKey, restrictedKey],
	]);

	const [readerRow] = await db
		.insert(users)
		.values({
			username: `t-${run}-reader`,
			displayName: `Reader ${run}`,
			email: null,
		})
		.returning();
	const [editorRow] = await db
		.insert(users)
		.values({
			username: `t-${run}-editor`,
			displayName: `Editor ${run}`,
			email: null,
		})
		.returning();
	reader = actor(readerRow, [readersGroup]);
	editor = actor(editorRow, [readersGroup]);
	const [nobodyRow] = await db
		.insert(users)
		.values({
			username: `t-${run}-nobody`,
			displayName: `Nobody ${run}`,
			email: null,
		})
		.returning();
	nobody = actor(nobodyRow, []);

	const [createdSpace] = await db
		.insert(spaces)
		.values({
			sourceId: `ws-space-${run}`,
			key: spaceKey,
			name: `Security space ${run}`,
			type: "global",
		})
		.returning();
	space = createdSpace;
	const [createdSecond] = await db
		.insert(spaces)
		.values({
			sourceId: `wt-space-${run}`,
			key: secondKey,
			name: `Second space ${run}`,
			type: "global",
		})
		.returning();
	secondSpace = createdSecond;
	const [createdRestricted] = await db
		.insert(spaces)
		.values({
			sourceId: `wu-space-${run}`,
			key: restrictedKey,
			name: `Restricted space ${run}`,
			type: "global",
			descriptionHtml: `<p>About ${run}</p><script>alert("description")</script><img src="x" onerror="steal()">`,
		})
		.returning();
	restrictedSpace = createdRestricted;

	await db.insert(spacePermissions).values([
		{
			sourceId: `ws-read-${run}`,
			spaceId: space.id,
			permission: "read",
			anonymous: true,
		},
		{
			sourceId: `ws-create-${run}`,
			spaceId: space.id,
			permission: "create",
			userId: editor.id,
		},
		{
			sourceId: `ws-administer-${run}`,
			spaceId: space.id,
			permission: "administer",
			groupName: nobodyGroup,
		},
		{
			sourceId: `wt-read-${run}`,
			spaceId: secondSpace.id,
			permission: "read",
			anonymous: true,
		},
		{
			sourceId: `wu-read-${run}`,
			spaceId: restrictedSpace.id,
			permission: "read",
			anonymous: true,
		},
	]);

	page = await createPage({
		spaceId: space.id,
		title: `Plain page ${run}`,
		bodyStorage: "<h1>Plain</h1><p>body</p>",
		bodyHtml: "<p>body</p>",
	});
	bodyHtmlOnly = await createPage({
		spaceId: space.id,
		title: `Legacy page ${run}`,
		bodyStorage: null,
		bodyHtml: [
			'<h1 onclick="steal()">Legacy</h1>',
			'<script>alert("legacy")</script>',
			'<p style="position:fixed;inset:0;text-align:left">overlay</p>',
			'<iframe src="https://evil.example/legacy">',
		].join(""),
	});
	stylePage = await createPage({
		spaceId: space.id,
		title: `Style page ${run}`,
		bodyStorage: [
			'<p style = "position:fixed;inset:0;text-align:left">a</p>',
			"<p STYLE='margin-left: 40.0px; color:red'>b</p>",
			'<span style="width: 100px; background:url(javascript:alert(1))">c</span>',
		].join(""),
		bodyHtml: "<p>style</p>",
	});
	iframePage = await createPage({
		spaceId: space.id,
		title: `Iframe page ${run}`,
		bodyStorage: [
			'<iframe src="https://www.youtube.com/embed/ok"></iframe>',
			'<iframe src="/download/attachments/1/file.pdf"></iframe>',
			'<p>a</p><iframe src="https://evil.example/one"></iframe>',
			'<iframe src="https://evil.example/two" />',
			'<iframe src="https://evil.example/three">',
		].join(""),
		bodyHtml: "<p>iframe</p>",
	});
	hiddenPage = await createPage({
		spaceId: space.id,
		title: `Hidden target ${run}`,
		bodyStorage: "<p>secret</p>",
		bodyHtml: "<p>secret</p>",
	});
	await db.insert(pageRestrictions).values({
		sourceId: `ws-hidden-${run}`,
		pageId: hiddenPage.id,
		operation: "read",
		groupName: nobodyGroup,
	});
	linkHostPage = await createPage({
		spaceId: space.id,
		title: `Link host ${run}`,
		bodyStorage: `<p><ac:link><ri:page ri:content-title="${hiddenPage.title}" /></ac:link></p>`,
		bodyHtml: "<p>links</p>",
	});
	jiraPage = await createPage({
		spaceId: space.id,
		title: `Jira page ${run}`,
		bodyStorage: `<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">${issueKey}</ac:parameter></ac:structured-macro>`,
		bodyHtml: "<p>jira</p>",
	});
	commentPage = await createPage({
		spaceId: space.id,
		title: `Comment page ${run}`,
		bodyStorage: "<p>comments</p>",
		bodyHtml: "<p>comments</p>",
	});
	labelPage = await createPage({
		spaceId: space.id,
		title: `Label page ${run}`,
		bodyStorage: "<p>labels</p>",
		bodyHtml: "<p>labels</p>",
	});
	const [label] = await db
		.insert(pageLabels)
		.values({
			sourceId: `ws-label-${run}`,
			pageId: labelPage.id,
			label: `existing-${run}`,
		})
		.returning();
	existingLabelId = label.id;
	restrictionsPage = await createPage({
		spaceId: space.id,
		title: `Restrictions page ${run}`,
		bodyStorage: "<p>restrictions</p>",
		bodyHtml: "<p>restrictions</p>",
	});
	await db.insert(pageRestrictions).values([
		{
			sourceId: `ws-restrict-read-${run}`,
			pageId: restrictionsPage.id,
			operation: "read",
			groupName: readersGroup,
		},
		{
			sourceId: `ws-restrict-update-${run}`,
			pageId: restrictionsPage.id,
			operation: "update",
			groupName: readersGroup,
		},
	]);
	restrictedHome = await createPage({
		spaceId: restrictedSpace.id,
		title: `Restricted home ${run}`,
		bodyStorage: "<p>home</p>",
		bodyHtml: "<p>home</p>",
	});
	await db.insert(pageRestrictions).values({
		sourceId: `wu-home-${run}`,
		pageId: restrictedHome.id,
		operation: "read",
		groupName: nobodyGroup,
	});
	await db
		.update(spaces)
		.set({ homePageId: restrictedHome.id })
		.where(eq(spaces.id, restrictedSpace.id));
	secondPage = await createPage({
		spaceId: secondSpace.id,
		title: `Second space page ${run}`,
		bodyStorage: "<p>second</p>",
		bodyHtml: "<p>second</p>",
		updated: new Date(Date.UTC(2026, 5, 1)),
	});
	recentHostPage = await createPage({
		spaceId: space.id,
		title: `Recent host ${run}`,
		bodyStorage: `<ac:structured-macro ac:name="recently-updated"><ac:parameter ac:name="spaces">${secondKey}</ac:parameter></ac:structured-macro>`,
		bodyHtml: "<p>recent</p>",
	});
	entityPage = await createPage({
		spaceId: space.id,
		title: `Entity page ${run}`,
		bodyStorage: "<h1>&#1114112;</h1>",
		bodyHtml: "<p>entity</p>",
	});

	await db.insert(pageComments).values({
		sourceId: `ws-comment-${run}`,
		pageId: commentPage.id,
		authorId: reader.id,
		bodyHtml:
			'<p>ok</p><script>alert("comment")</script><img src="x" onerror="steal()">',
		created: new Date(Date.UTC(2026, 0, 1)),
		updated: new Date(Date.UTC(2026, 0, 1)),
	});

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `ws-project-${run}`,
			key: `WSS${run.slice(0, 3).toUpperCase()}`,
			name: `Hidden project ${run}`,
			projectType: "software",
		})
		.returning();
	projectId = project.id;
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `ws-scheme-${run}`,
			name: `Hidden scheme ${run}`,
			projectIds: [projectId],
			raw: {},
		})
		.returning();
	await db.insert(permissionGrants).values({
		sourceId: `ws-scheme-browse-${run}`,
		schemeId: scheme.id,
		permissionKey: "BROWSE_PROJECTS",
		holderType: "group",
		holderParameter: nobodyGroup,
		raw: {},
	});
	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: `ws-type-${run}`, name: `Hidden story ${run}` })
		.returning();
	typeId = type.id;
	const [status] = await db
		.insert(statuses)
		.values({
			sourceId: `ws-status-${run}`,
			name: `Hidden status ${run}`,
			category: "indeterminate",
		})
		.returning();
	statusId = status.id;
	await db.insert(issues).values({
		sourceId: `ws-issue-${run}`,
		projectId,
		number: 1,
		key: issueKey,
		typeId,
		statusId,
		summary: issueSummary,
	});

	await attachment({
		pageId: page.id,
		fileName: "diagram.svg",
		mimeType: "image/svg+xml",
		storagePath: `security-${run}/diagram.svg`,
		content:
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
	});
	await attachment({
		pageId: page.id,
		fileName: "photo.png",
		mimeType: "image/png",
		storagePath: `security-${run}/photo.png`,
		content: "png",
	});
	await attachment({
		pageId: page.id,
		fileName: "50%25 off.pdf",
		mimeType: "application/pdf",
		storagePath: `security-${run}/percent.pdf`,
		content: "pdf",
	});
});

afterAll(async () => {
	await pool.query("delete from spaces where key = any($1)", [
		[spaceKey, secondKey, restrictedKey],
	]);
	await pool.query("delete from issues where project_id = $1", [projectId]);
	await pool.query("delete from permission_schemes where source_id = $1", [
		`ws-scheme-${run}`,
	]);
	await pool.query("delete from projects where id = $1", [projectId]);
	await pool.query("delete from issue_types where id = $1", [typeId]);
	await pool.query("delete from statuses where id = $1", [statusId]);
	await pool.query("delete from users where username like $1", [`t-${run}-%`]);
	await rm(attachmentDir, { recursive: true, force: true });
	await pool.end();
});

describe("page bodies go through the one sanitiser", () => {
	test("the bodyHtml fallback drops scripts, handlers and styles", async () => {
		const html = (await render(bodyHtmlOnly, reader)) ?? "";
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onclick");
		expect(html).not.toContain("position:fixed");
		expect(html).not.toContain("inset:0");
		expect(html).not.toMatch(/<iframe[^>]*evil\.example/);
		expect(html).toContain("<h1");
		expect(html).toContain("Legacy");
	});

	test("style attributes use the property and value allow-list", async () => {
		const html = (await render(stylePage, reader)) ?? "";
		expect(html).not.toContain("position");
		expect(html).not.toContain("inset");
		expect(html).not.toContain("color:red");
		expect(html).not.toContain("javascript:");
		expect(html).toContain("text-align:left");
		expect(html).toContain("margin-left:40.0px");
		expect(html).toContain("width:100px");
	});

	test("iframes are limited to the host allow-list in every form", async () => {
		const html = (await render(iframePage, reader)) ?? "";
		expect(html).not.toMatch(/<iframe[^>]*evil\.example/);
		expect(html).toContain("https://www.youtube.com/embed/ok");
		expect(html).toContain("/download/attachments/1/file.pdf");
	});

	test("iframes cannot grant device permissions", () => {
		const html = sanitizeWikiBody(
			'<iframe src="https://www.youtube.com/embed/x" allow="camera *; microphone *" allowfullscreen></iframe>',
		);
		expect(html).toContain("<iframe");
		expect(html).toContain("allowfullscreen");
		expect(html).not.toContain("allow=");
	});

	test("relative iframes only reach attachment downloads", () => {
		const html = sanitizeWikiBody(
			'<iframe src="/admin"></iframe><iframe src="/download/attachments/1/a.pdf"></iframe>',
		);
		expect(html).not.toMatch(/<iframe[^>]*\/admin/);
		expect(html).toContain('src="/download/attachments/1/a.pdf"');
	});

	test("only anchors and headings keep an author-supplied id", () => {
		const html = sanitizeWikiBody(
			'<p id="clobber">p</p><div id="box">d</div><h2 id="keep">h</h2><a id="anchor" href="/x">a</a>',
		);
		expect(html).not.toContain('id="clobber"');
		expect(html).not.toContain('id="box"');
		expect(html).toContain('id="keep"');
		expect(html).toContain('id="anchor"');
	});

	test("a link that opens a new window cannot reach its opener", () => {
		const html = sanitizeWikiBody(
			'<p><a href="https://example.test/" target="_blank" rel="opener">x</a></p>',
		);
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).not.toContain('rel="opener"');
	});

	test("comment HTML is sanitised when it is returned", async () => {
		const comments = await listComments(reader, commentPage.id);
		const body = comments[0]?.bodyHtml ?? "";
		expect(body).toContain("<p>ok</p>");
		expect(body).not.toContain("<script");
		expect(body).not.toContain("onerror");
	});
});

describe("reader visibility", () => {
	test("the jira macro hides issues from projects the reader cannot browse", async () => {
		const html = (await render(jiraPage, reader)) ?? "";
		expect(html).toContain("was not found");
		expect(html).not.toContain(issueSummary);
		expect(html).not.toContain("wiki-jira-issue");
	});

	test("the jira macro shows an issue to a reader who browses the project through a group", async () => {
		const member = { ...reader, groups: [readersGroup, nobodyGroup] };
		const page = await getPage(member, jiraPage.id);
		expect(page.bodyHtml).toContain("wiki-jira-issue");
		expect(page.bodyHtml).toContain(issueSummary);
	});

	test("page links resolve only to pages the reader may see", async () => {
		const html = (await render(linkHostPage, reader)) ?? "";
		expect(html).toContain("wiki-missing-link");
		expect(html).not.toContain(hiddenPage.sourceId);
	});

	test("contributors of a page the reader cannot see are not returned", async () => {
		await db.insert(pageVersions).values({
			sourceId: `ws-hidden-version-${randomUUID()}`,
			pageId: hiddenPage.id,
			number: 1,
			title: hiddenPage.title,
			bodyStorage: "<p>secret</p>",
			bodyHtml: "<p>secret</p>",
			authorId: editor.id,
			created: new Date(Date.UTC(2026, 0, 1)),
		});
		expect(
			await pageContributors(await loadWikiAccess(nobody), hiddenPage.id),
		).toEqual([]);
		expect(
			(
				await pageContributors(
					await loadWikiAccess({ ...editor, isAdmin: true }),
					hiddenPage.id,
				)
			).length,
		).toBe(1);
	});

	test("attachments of a page the reader cannot see are not returned", async () => {
		await attachment({
			pageId: hiddenPage.id,
			fileName: `hidden-${run}.txt`,
			mimeType: "text/plain",
			storagePath: `security-${run}/hidden.txt`,
			content: "secret",
		});
		const nobodyAccess = await loadWikiAccess(nobody);
		expect(await latestAttachments(nobodyAccess, hiddenPage.id)).toEqual([]);
		expect(await pageAttachmentVersions(nobodyAccess, hiddenPage.id)).toEqual(
			[],
		);

		const adminAccess = await loadWikiAccess({ ...editor, isAdmin: true });
		const latest = await latestAttachments(adminAccess, hiddenPage.id);
		const versions = await pageAttachmentVersions(adminAccess, hiddenPage.id);
		expect(latest).toHaveLength(1);
		expect(versions).toHaveLength(1);
		for (const row of [...latest, ...versions]) {
			expect(row).toMatchObject({
				authorUsername: editor.username,
				authorAvatarUrl: `/api/avatars/users/${editor.id}`,
			});
		}
	});

	test("a restricted home page and raw description are not serialised", async () => {
		const summary = await getSpace(reader, restrictedSpace.key);
		expect(summary.homePage).toBeNull();
		expect(summary.descriptionHtml).not.toContain("<script");
		expect(summary.descriptionHtml).not.toContain("onerror");
		expect(summary.descriptionHtml).toContain("About");
	});

	test("a reader gets page restrictions but not the space permission list", async () => {
		const restrictions = await getPageRestrictions(reader, restrictionsPage.id);
		expect(restrictions.page.length).toBeGreaterThan(0);
		expect(restrictions.space).toEqual([]);
	});

	test("an editor gets the full restriction list", async () => {
		const restrictions = await getPageRestrictions(editor, restrictionsPage.id);
		expect(restrictions.page.length).toBeGreaterThan(0);
		expect(restrictions.space.length).toBeGreaterThan(0);
	});
});

describe("labels need the editor's right", () => {
	test("a reader cannot add or delete labels", async () => {
		await expect(
			ensurePageLabel(reader, labelPage.id, `reader-${run}`),
		).rejects.toMatchObject({ status: 403 });
		await expect(deleteLabel(reader, existingLabelId)).rejects.toMatchObject({
			status: 403,
		});
	});

	test("an editor can add and delete labels", async () => {
		const added = await ensurePageLabel(editor, labelPage.id, `editor-${run}`);
		expect(added.created).toBe(true);
		await expect(deleteLabel(editor, added.label.id)).resolves.toBeUndefined();
	});
});

describe("downloads", () => {
	test("active types are always attachments and every response is sandboxed", async () => {
		const svg = await attachmentDownloadByName(
			reader,
			page.sourceId,
			"diagram.svg",
			{ inline: "1" },
		);
		expect(svg.inline).toBe(false);
		const response = fileResponse(svg, { size: true, caching: true });
		expect(response.headers.get("content-security-policy")).toBe("sandbox");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-disposition")).toContain("attachment");
	});

	test("thumbnails reject SVG and serve raster images", async () => {
		await expect(
			thumbnailDownload(reader, page.sourceId, "diagram.svg"),
		).rejects.toMatchObject({ status: 404 });
		const png = await thumbnailDownload(reader, page.sourceId, "photo.png");
		expect(png.inline).toBe(true);
		const response = fileResponse(png, { size: false, caching: false });
		expect(response.headers.get("content-security-policy")).toBe("sandbox");
		expect(response.headers.get("content-disposition")).toContain("inline");
	});

	test("a file name is not decoded a second time", async () => {
		const file = await attachmentDownloadByName(
			reader,
			page.sourceId,
			"50%25 off.pdf",
			{},
		);
		expect(file.fileName).toBe("50%25 off.pdf");
		expect(file.filePath).toContain("percent.pdf");
	});
});

describe("macro space parameters", () => {
	test("explicit space keys resolve to those spaces", async () => {
		const html = (await render(recentHostPage, reader)) ?? "";
		expect(html).toContain(secondPage.title);
	});
});

describe("entity decoding", () => {
	test("out-of-range and surrogate entities stay as text", () => {
		expect(decodeEntities("&#65;")).toBe("A");
		expect(decodeEntities("&#1114112;")).toBe("&#1114112;");
		expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
	});

	test("a stored heading with an out-of-range entity still renders", async () => {
		await expect(render(entityPage, reader)).resolves.toContain("<h1");
	});
});

describe("a user with no readable space", () => {
	test("home, directory, search and macros are empty without an error", async () => {
		const anonymous = await db
			.select()
			.from(spacePermissions)
			.where(eq(spacePermissions.anonymous, true));
		await db
			.delete(spacePermissions)
			.where(eq(spacePermissions.anonymous, true));
		try {
			const access = await loadWikiAccess(nobody);
			expect(access.readableSpaceIds.size).toBe(0);

			const visible = await db
				.select({ id: pages.id })
				.from(pages)
				.where(visiblePages(access));
			expect(visible).toEqual([]);

			const home = await wikiHome(nobody);
			expect(home.recent).toEqual([]);
			expect(home.spaces).toEqual([]);
			expect(home.created).toEqual([]);
			expect(home.watched).toEqual([]);

			expect(await listSpaces(nobody, {})).toEqual([]);

			const result = await searchPages(nobody, {
				query: `Plain page ${run}`,
				offset: 0,
				limit: 25,
			});
			expect(result.total).toBe(0);
			expect(result.hits).toEqual([]);

			const context: MacroContext = {
				user: nobody,
				access,
				page: {
					id: page.id,
					sourceId: page.sourceId,
					spaceId: page.spaceId,
					title: page.title,
				},
				space,
				storage: {
					pageSourceId: page.sourceId,
					attachments: new Map(),
					pageSourceIdByTitle: new Map(),
					otherSpacePages: new Map(),
					spaceKey: "",
					inlineMarkers: new Set(),
				},
				renderBody: async () => "",
				searchUser: { id: nobody.id, username: nobody.username },
			};
			const children = await renderMacro(
				{
					name: "children",
					params: {},
					body: null,
					plain: null,
					raw: "",
					start: 0,
					end: 0,
				},
				context,
			);
			expect(children).toContain("No child pages.");
			const jira = await renderMacro(
				{
					name: "jira",
					params: { key: issueKey },
					body: null,
					plain: null,
					raw: "",
					start: 0,
					end: 0,
				},
				context,
			);
			expect(jira).toContain("was not found");
		} finally {
			if (anonymous.length > 0) {
				await db.insert(spacePermissions).values(anonymous);
			}
		}
	});
});
