import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	pageLabels,
	pageRestrictions,
	spacePermissions,
	users,
} from "../src/lib/server/schema.ts";
import { pages, spaces } from "../src/lib/server/schema-wiki.ts";
import { loadWikiAccess } from "../src/lib/server/wiki/permissions.ts";
import { renderWikiBody } from "../src/lib/server/wiki/render.ts";
import { findMacros } from "../src/lib/server/wiki/storage.ts";

const run = randomUUID().slice(0, 8);
const spaceKey = `OM${run.slice(0, 4).toUpperCase()}`;
const otherKey = `ON${run.slice(0, 4).toUpperCase()}`;
const hiddenGroup = `old-macro-hidden-${run}`;

let space: typeof spaces.$inferSelect;
let otherSpace: typeof spaces.$inferSelect;
let admin: CurrentUser;
let reader: CurrentUser;

async function createPage(
	spaceId: string,
	title: string,
	storage: string,
	labels: string[] = [],
) {
	const [row] = await db
		.insert(pages)
		.values({
			sourceId: `old-macro-${randomUUID()}`,
			spaceId,
			title,
			status: "current",
			bodyStorage: storage,
			bodyHtml: `<p>${title}</p>`,
			creatorId: admin.id,
			created: new Date(Date.UTC(2026, 0, 1)),
			lastModifierId: admin.id,
			updated: new Date(Date.UTC(2026, 0, 2)),
		})
		.returning();
	for (const label of labels) {
		await db.insert(pageLabels).values({
			sourceId: `old-macro-label-${randomUUID()}`,
			pageId: row.id,
			label,
		});
	}
	return row;
}

async function render(
	page: typeof pages.$inferSelect,
	who: CurrentUser = admin,
	spaceRow: typeof spaces.$inferSelect = space,
) {
	const access = await loadWikiAccess(who);
	return renderWikiBody(
		{
			id: page.id,
			sourceId: page.sourceId,
			spaceId: page.spaceId,
			title: page.title,
			bodyStorage: page.bodyStorage,
			bodyHtml: page.bodyHtml,
		},
		{ user: who, access, space: spaceRow, searchUser: who },
	);
}

function actor(row: typeof users.$inferSelect, isAdmin: boolean): CurrentUser {
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin,
		mustChangePassword: false,
		hasPassword: false,
	};
}

beforeAll(async () => {
	await runMigrations();
	await pool.query("delete from spaces where key = any($1)", [
		[spaceKey, otherKey],
	]);
	await pool.query("delete from users where username like $1", [
		`old-macro-${run}-%`,
	]);

	const [createdSpace] = await db
		.insert(spaces)
		.values({
			sourceId: `old-macro-space-${run}`,
			key: spaceKey,
			name: `Old macro space ${run}`,
			type: "global",
		})
		.returning();
	space = createdSpace;
	const [createdOther] = await db
		.insert(spaces)
		.values({
			sourceId: `old-macro-other-${run}`,
			key: otherKey,
			name: `Old macro other ${run}`,
			type: "global",
		})
		.returning();
	otherSpace = createdOther;

	const [adminRow] = await db
		.insert(users)
		.values({
			username: `old-macro-${run}-admin`,
			displayName: `Old macro admin ${run}`,
			email: null,
		})
		.returning();
	const [readerRow] = await db
		.insert(users)
		.values({
			username: `old-macro-${run}-reader`,
			displayName: `Old macro reader ${run}`,
			email: null,
		})
		.returning();
	admin = actor(adminRow, true);
	reader = actor(readerRow, false);

	await db.insert(spacePermissions).values({
		sourceId: `old-macro-read-${run}`,
		spaceId: space.id,
		permission: "read",
		anonymous: true,
	});
});

afterAll(async () => {
	await pool.query("delete from spaces where key = any($1)", [
		[spaceKey, otherKey],
	]);
	await pool.query("delete from users where username like $1", [
		`old-macro-${run}-%`,
	]);
	await pool.end();
});

test("an old-format tip keeps its body", async () => {
	const page = await createPage(
		space.id,
		`Old tip ${run}`,
		'<ac:macro ac:name="tip"><ac:parameter ac:name="title">Old title</ac:parameter><ac:rich-text-body><p>old tip body</p></ac:rich-text-body></ac:macro>',
	);
	const html = await render(page);
	expect(html).toContain('class="wiki-panel wiki-panel-tip"');
	expect(html).toContain("Old title");
	expect(html).toContain("old tip body");
	expect(html).not.toContain("<ac:macro");
});

test("old and structured macros nest in either order", async () => {
	const structuredOuter = await createPage(
		space.id,
		`Structured outer ${run}`,
		'<ac:structured-macro ac:name="tip"><ac:rich-text-body><p>structured outer</p><ac:macro ac:name="note"><ac:rich-text-body><p>old inner</p></ac:rich-text-body></ac:macro></ac:rich-text-body></ac:structured-macro>',
	);
	const oldOuter = await createPage(
		space.id,
		`Old outer ${run}`,
		'<ac:macro ac:name="tip"><ac:rich-text-body><p>old outer</p><ac:structured-macro ac:name="note"><ac:rich-text-body><p>structured inner</p></ac:rich-text-body></ac:structured-macro></ac:rich-text-body></ac:macro>',
	);

	const first = await render(structuredOuter);
	expect(first).toContain("wiki-panel-tip");
	expect(first).toContain("wiki-panel-note");
	expect(first).toContain("structured outer");
	expect(first).toContain("old inner");

	const second = await render(oldOuter);
	expect(second).toContain("wiki-panel-tip");
	expect(second).toContain("wiki-panel-note");
	expect(second).toContain("old outer");
	expect(second).toContain("structured inner");
});

test("livesearch posts a GET form to the wiki search screen", async () => {
	const page = await createPage(
		space.id,
		`Livesearch ${run}`,
		`<ac:macro ac:name="livesearch"><ac:parameter ac:name="spaceKey">${otherKey}</ac:parameter><ac:parameter ac:name="placeholder">Find a page</ac:parameter></ac:macro>`,
	);
	const html = await render(page);
	expect(html).toContain('data-macro="livesearch"');
	expect(html).toContain('action="/dosearchsite.action"');
	expect(html).toContain('method="get"');
	expect(html).toContain(`name="space" value="${otherKey}"`);
	expect(html).toContain('name="queryString"');
	expect(html).toContain('placeholder="Find a page"');
	expect(html).toContain("<button");
});

test("a form an author writes into the page body does not reach the reader", async () => {
	const page = await createPage(
		space.id,
		`Author form ${run}`,
		'<form action="https://example.org/collect" method="post"><input type="password" name="secret" /><button type="submit">Sign in</button></form>',
	);
	const html = await render(page);
	expect(html).not.toContain("<form");
	expect(html).not.toContain("example.org");
	expect(html).not.toContain('type="password"');
});

test("livesearch defaults to the page's space", async () => {
	const page = await createPage(
		space.id,
		`Livesearch default ${run}`,
		'<ac:macro ac:name="livesearch" />',
	);
	const html = await render(page);
	expect(html).toContain(`name="space" value="${spaceKey}"`);
});

test("popular-labels lists readable labels only", async () => {
	await createPage(space.id, `Common one ${run}`, "<p>a</p>", ["common"]);
	await createPage(space.id, `Common two ${run}`, "<p>b</p>", ["common"]);
	await createPage(space.id, `Rare ${run}`, "<p>c</p>", ["rare"]);
	const hidden = await createPage(space.id, `Hidden ${run}`, "<p>d</p>", [
		"secret",
	]);
	await db.insert(pageRestrictions).values({
		sourceId: `old-macro-hidden-${run}`,
		pageId: hidden.id,
		operation: "read",
		groupName: hiddenGroup,
	});
	await createPage(otherSpace.id, `Other ${run}`, "<p>e</p>", ["other"]);

	const host = await createPage(
		space.id,
		`Popular labels ${run}`,
		'<ac:macro ac:name="popular-labels"><ac:parameter ac:name="count">10</ac:parameter></ac:macro>',
	);
	const html = await render(host, reader);
	expect(html).toContain('data-macro="popular-labels"');
	expect(html).toContain('href="/label/common"');
	expect(html).toContain('href="/label/rare"');
	expect(html).not.toContain('href="/label/secret"');
	expect(html).not.toContain('href="/label/other"');
	const commonAt = html?.indexOf('href="/label/common"') ?? -1;
	const rareAt = html?.indexOf('href="/label/rare"') ?? -1;
	expect(commonAt).toBeLessThan(rareAt);

	const one = await render(
		await createPage(
			space.id,
			`Popular labels one ${run}`,
			'<ac:macro ac:name="popular-labels"><ac:parameter ac:name="count">1</ac:parameter></ac:macro>',
		),
		reader,
	);
	expect(one).toContain('href="/label/common"');
	expect(one).not.toContain('href="/label/rare"');

	const otherSpaceHtml = await render(
		await createPage(
			space.id,
			`Popular labels space ${run}`,
			`<ac:macro ac:name="popular-labels"><ac:parameter ac:name="spaceKey">${otherKey}</ac:parameter></ac:macro>`,
		),
		admin,
	);
	expect(otherSpaceHtml).toContain('href="/label/other"');
	expect(otherSpaceHtml).not.toContain('href="/label/common"');
});

test("create-from-template links to the create page under the current page", async () => {
	const page = await createPage(
		space.id,
		`Create from template ${run}`,
		'<ac:macro ac:name="create-from-template"><ac:parameter ac:name="buttonLabel">New retrospective</ac:parameter><ac:parameter ac:name="title">Planned title</ac:parameter></ac:macro>',
	);
	const html = await render(page);
	expect(html).toContain('data-macro="create-from-template"');
	expect(html).toContain(
		`href="/pages/createpage.action?spaceKey=${spaceKey}&amp;fromPageId=${page.id}&amp;title=Planned+title"`,
	);
	expect(html).toContain("New retrospective");

	const fallback = await render(
		await createPage(
			space.id,
			`Create default ${run}`,
			'<ac:macro ac:name="create-from-template" />',
		),
	);
	expect(fallback).toContain("Create from template");
	expect(fallback).toContain(`spaceKey=${spaceKey}`);
	expect(fallback).toContain(`fromPageId=`);
});

test("an old-format details macro feeds the page properties report", async () => {
	await createPage(
		space.id,
		`Old properties source ${run}`,
		'<ac:macro ac:name="details"><ac:rich-text-body><tbody><tr><th>Owner</th><td>Team</td></tr></tbody></ac:rich-text-body></ac:macro>',
	);
	const host = await createPage(
		space.id,
		`Old properties report ${run}`,
		'<ac:macro ac:name="detailssummary"><ac:parameter ac:name="heading">Old report</ac:parameter><ac:parameter ac:name="columns">Owner</ac:parameter></ac:macro>',
	);
	const html = await render(host);
	expect(html).toContain("wiki-properties-report");
	expect(html).toContain("Old report");
	expect(html).toContain(`Old properties source ${run}`);
	expect(html).toContain("<td>Team</td>");
});

test("an old-format macro with no renderer still shows the unknown box", async () => {
	const page = await createPage(
		space.id,
		`Old unknown ${run}`,
		'<ac:macro ac:name="noformat"><ac:plain-text-body><![CDATA[raw]]></ac:plain-text-body></ac:macro>',
	);
	const html = await render(page);
	expect(html).toContain('class="wiki-unknown-macro"');
	expect(html).toContain("noformat");
});

test("the macro scan stays fast on unclosed and crossed tags", () => {
	const unclosed = '<ac:macro ac:name="tip">'.repeat(20_000);
	const crossed = `${unclosed}${"</ac:structured-macro>".repeat(20_000)}</ac:macro>`;
	const started = performance.now();
	expect(findMacros(unclosed)).toEqual([]);
	expect(findMacros(crossed).map((macro) => macro.name)).toEqual(["tip"]);
	expect(performance.now() - started).toBeLessThan(2_000);
});

test("an unclosed macro does not hide the macros after it", () => {
	const names = (storage: string) =>
		findMacros(storage).map((macro) => macro.name);
	expect(
		names(
			'<ac:macro ac:name="lost"><ac:structured-macro ac:name="info"><ac:rich-text-body><p>x</p></ac:rich-text-body></ac:structured-macro>',
		),
	).toEqual(["info"]);
	expect(
		names(
			'<ac:macro ac:name="first"><ac:macro ac:name="second"></ac:macro><ac:structured-macro ac:name="toc" />',
		),
	).toEqual(["second", "toc"]);
});

test("a page with thousands of macros renders in bounded time", async () => {
	const page = await createPage(
		space.id,
		`Many macros ${run}`,
		'<ac:structured-macro ac:name="info"><ac:rich-text-body><p>x</p></ac:rich-text-body></ac:structured-macro>'.repeat(
			3000,
		),
	);
	const started = performance.now();
	const html = await render(page);
	expect(performance.now() - started).toBeLessThan(5_000);
	expect(html?.match(/data-macro="info"/g)?.length).toBe(2000);
	expect(html).toContain("too many macros");
});

test("macros nested thousands deep do not crash the page read", async () => {
	const depth = 3000;
	const page = await createPage(
		space.id,
		`Deep macros ${run}`,
		`${'<ac:structured-macro ac:name="info"><ac:rich-text-body>'.repeat(depth)}<p>deep</p>${"</ac:rich-text-body></ac:structured-macro>".repeat(depth)}`,
	);
	const html = await render(page);
	expect(html?.match(/data-macro="info"/g)?.length).toBe(31);
});

test("a link to a page in another space resolves, whatever the attribute order", async () => {
	const target = await createPage(otherSpace.id, `Linked ${run}`, "<p>t</p>");
	const page = await createPage(
		space.id,
		`Linker ${run}`,
		`<p><ac:link><ri:page ri:space-key="${otherKey.toLowerCase()}" ri:content-title="Linked ${run}" /></ac:link> <ac:link><ri:page ri:content-title="Linked ${run}" ri:space-key="${otherKey}" /></ac:link></p>`,
	);
	const html = await render(page);
	expect(html?.split(`pageId=${target.sourceId}`).length).toBe(3);
	const forReader = await render(page, reader);
	expect(forReader).not.toContain(target.sourceId);
	expect(forReader?.match(/wiki-missing-link/g)?.length).toBe(2);
});

test("a link into a space the reader cannot read does not fall back to a page with the same title here", async () => {
	const title = `Same title ${run}`;
	const local = await createPage(space.id, title, "<p>local</p>");
	await createPage(otherSpace.id, title, "<p>other</p>");
	const page = await createPage(
		space.id,
		`Fallback ${run}`,
		`<p><ac:link><ri:page ri:space-key="${otherKey}" ri:content-title="${title}" /></ac:link> <ac:link><ri:page ri:space-key="NOSUCH${run}" ri:content-title="${title}" /></ac:link> <ac:link><ri:page ri:space-key="${spaceKey.toLowerCase()}" ri:content-title="${title}" /></ac:link></p>`,
	);
	const forReader = await render(page, reader);
	expect(forReader?.match(/wiki-missing-link/g)?.length).toBe(2);
	expect(forReader?.split(`pageId=${local.sourceId}`).length).toBe(2);
});
