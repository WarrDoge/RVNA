import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	issues,
	issueTypes,
	pageAttachments,
	pageLabels,
	pageVersions,
	projects,
	statuses,
	users,
} from "../src/lib/server/schema.ts";
import { pages, spaces } from "../src/lib/server/schema-wiki.ts";
import {
	childPageLinks,
	pagesWithProperties,
} from "../src/lib/server/wiki/data.ts";
import {
	type MacroContext,
	macroNames,
	macroRenderers,
	renderMacro,
} from "../src/lib/server/wiki/macros.ts";
import { loadWikiAccess } from "../src/lib/server/wiki/permissions.ts";
import { renderWikiBody } from "../src/lib/server/wiki/render.ts";

const run = randomUUID().slice(0, 8);
const spaceKey = `WM${run.slice(0, 4).toUpperCase()}`;
const issueKey = `WIKI${run.slice(0, 3).toUpperCase()}-1`;

let space: typeof spaces.$inferSelect;
let user: CurrentUser;
let projectId: string;
let typeId: string;
let statusId: string;

async function createPage(
	title: string,
	storage: string,
	options: {
		parentId?: string | null;
		position?: number;
		labels?: string[];
		updated?: Date;
		status?: "current" | "draft" | "trashed";
		type?: "page" | "blogpost";
		spaceId?: string;
	} = {},
) {
	const [row] = await db
		.insert(pages)
		.values({
			sourceId: `wm-${randomUUID()}`,
			spaceId: options.spaceId ?? space.id,
			parentId: options.parentId ?? null,
			position: options.position ?? 0,
			title,
			status: options.status ?? "current",
			type: options.type ?? "page",
			bodyStorage: storage,
			bodyHtml: `<p>${title}</p>`,
			creatorId: user.id,
			created: new Date(Date.UTC(2026, 0, 1)),
			lastModifierId: user.id,
			updated: options.updated ?? new Date(Date.UTC(2026, 0, 2)),
		})
		.returning();
	for (const label of options.labels ?? []) {
		await db.insert(pageLabels).values({
			sourceId: `wm-${randomUUID()}`,
			pageId: row.id,
			label,
		});
	}
	return row;
}

function storage(macro: string) {
	return `<p>before</p>${macro}<p>after</p>`;
}

async function render(
	page: typeof pages.$inferSelect,
	options: { spaceRow?: typeof spaces.$inferSelect } = {},
) {
	const access = await loadWikiAccess(user);
	return renderWikiBody(
		{
			id: page.id,
			sourceId: page.sourceId,
			spaceId: page.spaceId,
			title: page.title,
			bodyStorage: page.bodyStorage,
			bodyHtml: page.bodyHtml,
		},
		{
			user,
			access,
			space: options.spaceRow ?? space,
			searchUser: { id: user.id, username: user.username },
		},
	);
}

async function macroContext(
	page: typeof pages.$inferSelect,
): Promise<MacroContext> {
	return {
		user,
		access: await loadWikiAccess(user),
		page: {
			id: page.id,
			sourceId: page.sourceId,
			spaceId: page.spaceId,
			title: page.title,
		},
		space,
		storage: {
			pageSourceId: page.sourceId,
			spaceKey: space.key,
			attachments: new Map(),
			pageSourceIdByTitle: new Map(),
			otherSpacePages: new Map(),
			inlineMarkers: new Set(),
		},
		renderBody: async () => "",
		searchUser: { id: user.id, username: user.username },
	};
}

beforeAll(async () => {
	await runMigrations();
	await pool.query("delete from spaces where key = $1", [spaceKey]);

	const [created] = await db
		.insert(spaces)
		.values({
			sourceId: `wm-space-${run}`,
			key: spaceKey,
			name: `Macro space ${run}`,
			type: "global",
		})
		.returning();
	space = created;

	const [createdUser] = await db
		.insert(users)
		.values({
			username: `t-${run}-macros`,
			displayName: `Macro User ${run}`,
			email: null,
		})
		.onConflictDoNothing()
		.returning();
	user = {
		id: createdUser.id,
		username: createdUser.username,
		displayName: createdUser.displayName,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: true,
		mustChangePassword: false,
		hasPassword: false,
	};

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `wm-project-${run}`,
			key: `WM${run.slice(0, 4).toUpperCase()}`,
			name: `Wiki macro project ${run}`,
			projectType: "software",
		})
		.returning();
	projectId = project.id;
	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: `wm-type-${run}`, name: `Wiki Story ${run}` })
		.returning();
	typeId = type.id;
	const [status] = await db
		.insert(statuses)
		.values({
			sourceId: `wm-status-${run}`,
			name: `Wiki In Progress ${run}`,
			category: "indeterminate",
		})
		.returning();
	statusId = status.id;
	await db.insert(issues).values({
		sourceId: `wm-issue-${run}`,
		projectId,
		number: 1,
		key: issueKey,
		typeId,
		statusId,
		summary: `Macro issue ${run}`,
	});
});

afterAll(async () => {
	await pool.query("delete from spaces where key = $1", [spaceKey]);
	await pool.query("delete from issues where project_id = $1", [projectId]);
	await pool.query("delete from projects where id = $1", [projectId]);
	await pool.query("delete from issue_types where source_id = $1", [
		`wm-type-${run}`,
	]);
	await pool.query("delete from statuses where source_id = $1", [
		`wm-status-${run}`,
	]);
	await pool.query("delete from users where username = $1", [user.username]);
	await pool.end();
});

test("renders headings, tables and code with the Confluence typography hooks", async () => {
	const page = await createPage(
		"Typography",
		"<h1>Top</h1><h2>Second</h2><table><tbody><tr><th>Key</th><td>Value</td></tr></tbody></table><p>text</p>",
	);
	const html = await render(page);
	expect(html).toContain('<h1 id="top">Top</h1>');
	expect(html).toContain('<h2 id="second">Second</h2>');
	expect(html).toContain("<th>Key</th>");
});

test("child page order follows the requested sort and direction", async () => {
	const parent = await createPage("Sort parent", "<p>parent</p>");
	for (const [index, title] of ["Alpha", "Bravo", "Charlie"].entries()) {
		const child = await createPage(title, "<p>child</p>", {
			parentId: parent.id,
			position: index,
			updated: new Date(Date.UTC(2026, 0, index + 10)),
		});
		await db
			.update(pages)
			.set({ created: new Date(Date.UTC(2026, 0, index + 1)) })
			.where(eq(pages.id, child.id));
	}
	const access = await loadWikiAccess(user);
	const titles = async (options: Parameters<typeof childPageLinks>[2] = {}) =>
		(await childPageLinks(access, parent.id, options)).map((row) => row.title);

	expect(await titles()).toEqual(["Alpha", "Bravo", "Charlie"]);
	expect(await titles({ reverse: true })).toEqual([
		"Charlie",
		"Bravo",
		"Alpha",
	]);
	expect(await titles({ sort: "creation" })).toEqual([
		"Alpha",
		"Bravo",
		"Charlie",
	]);
	expect(await titles({ sort: "creation", reverse: true })).toEqual([
		"Charlie",
		"Bravo",
		"Alpha",
	]);
	expect(await titles({ sort: "modified" })).toEqual([
		"Alpha",
		"Bravo",
		"Charlie",
	]);
	expect(await titles({ sort: "modified", reverse: true })).toEqual([
		"Charlie",
		"Bravo",
		"Alpha",
	]);
});

const macroCases: {
	name: string;
	storage: string;
	expect: string[];
	absent?: string[];
	setup?: () => Promise<void>;
}[] = [
	{
		name: "tip",
		storage: storage(
			'<ac:structured-macro ac:name="tip"><ac:parameter ac:name="title">Careful</ac:parameter><ac:rich-text-body><p>tip body</p></ac:rich-text-body></ac:structured-macro>',
		),
		expect: ['class="wiki-panel wiki-panel-tip"', "Careful", "tip body"],
	},
	{
		name: "info",
		storage: storage(
			'<ac:structured-macro ac:name="info"><ac:rich-text-body><p>info body</p></ac:rich-text-body></ac:structured-macro>',
		),
		expect: ["wiki-panel-info", "info body"],
	},
	{
		name: "note",
		storage: storage(
			'<ac:structured-macro ac:name="note"><ac:rich-text-body><p>note body</p></ac:rich-text-body></ac:structured-macro>',
		),
		expect: ["wiki-panel-note", "note body"],
	},
	{
		name: "warning",
		storage: storage(
			'<ac:structured-macro ac:name="warning"><ac:rich-text-body><p>warning body</p></ac:rich-text-body></ac:structured-macro>',
		),
		expect: ["wiki-panel-warning", "warning body"],
	},
	{
		name: "panel",
		storage: storage(
			'<ac:structured-macro ac:name="panel"><ac:parameter ac:name="title">Boxed</ac:parameter><ac:rich-text-body><p>panel body</p></ac:rich-text-body></ac:structured-macro>',
		),
		expect: ["wiki-panel-panel", "Boxed", "panel body"],
	},
	{
		name: "code",
		storage: storage(
			'<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">json</ac:parameter><ac:parameter ac:name="title">Config</ac:parameter><ac:parameter ac:name="linenumbers">true</ac:parameter><ac:plain-text-body><![CDATA[{"a": 1}]]></ac:plain-text-body></ac:structured-macro>',
		),
		expect: ["wiki-code", "Config", "wiki-code-number", '{"a": 1}'],
	},
	{
		name: "toc",
		storage: `<p>intro</p><ac:structured-macro ac:name="toc"><ac:parameter ac:name="minLevel">2</ac:parameter><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro><h1>One</h1><h2>Two</h2>`,
		expect: ['class="wiki-toc"', 'href="#two"', "wiki-toc-list"],
	},
	{
		name: "children",
		storage: storage('<ac:structured-macro ac:name="children" />'),
		expect: ["wiki-children", "Macro child"],
		setup: async () => {
			// The parent is created by the test body; see below.
		},
	},
	{
		name: "jira",
		storage: storage(
			`<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">${issueKey}</ac:parameter></ac:structured-macro>`,
		),
		expect: ["wiki-jira-issue", issueKey, `Macro issue ${run}`, "wiki-lozenge"],
	},
	{
		name: "jira jql",
		storage: storage(
			`<ac:structured-macro ac:name="jira"><ac:parameter ac:name="jql">key = ${issueKey}</ac:parameter><ac:parameter ac:name="columns">key,summary,status</ac:parameter></ac:structured-macro>`,
		),
		expect: ["wiki-jira-table", issueKey, `Macro issue ${run}`],
	},
	{
		name: "view-file image",
		storage: storage(
			'<ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name">diagram.png</ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-file-preview", "<img", "diagram.png"],
	},
	{
		name: "view-file pdf",
		storage: storage(
			'<ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name">manual.pdf</ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-file-pdf", "<iframe"],
	},
	{
		name: "view-file other",
		storage: storage(
			'<ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name">notes.docx</ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-file-name", "notes.docx"],
	},
	{
		name: "view-file empty name falls back to title",
		storage: storage(
			'<ac:structured-macro ac:name="view-file"><ac:parameter ac:name="title">notes.docx</ac:parameter><ac:parameter ac:name="name"/></ac:structured-macro>',
		),
		expect: ["wiki-file-name", "notes.docx"],
		absent: ["missing attachment"],
	},
	{
		name: "recently-updated",
		storage: storage(
			'<ac:structured-macro ac:name="recently-updated"><ac:parameter ac:name="max">3</ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-recent", "Recently updated"],
	},
	{
		name: "contentbylabel",
		storage: storage(
			'<ac:structured-macro ac:name="contentbylabel"><ac:parameter ac:name="labels">featured</ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-labeled", "Featured page"],
	},
	{
		name: "contributors",
		storage: storage('<ac:structured-macro ac:name="contributors" />'),
		expect: ["wiki-contributors", `Macro User ${run}`],
	},
	{
		name: "widget allowed host",
		storage: storage(
			'<ac:structured-macro ac:name="widget"><ac:parameter ac:name="url"><ri:url ri:value="https://www.youtube.com/embed/abc123" /></ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-widget", "<iframe", "youtube.com/embed/abc123"],
	},
	{
		name: "widget other host",
		storage: storage(
			'<ac:structured-macro ac:name="widget"><ac:parameter ac:name="url"><ri:url ri:value="https://example.test/page" /></ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-widget-link", "example.test/page"],
	},
	{
		name: "attachments",
		storage: storage('<ac:structured-macro ac:name="attachments" />'),
		expect: ["wiki-attachments", "diagram.png", "notes.docx"],
	},
	{
		name: "attachments wildcard",
		storage: storage(
			'<ac:structured-macro ac:name="attachments"><ac:parameter ac:name="patterns">*.PDF, diagram.pn?</ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-attachments", "manual.pdf", "diagram.png"],
		absent: ["notes.docx"],
	},
	{
		name: "attachments regular expression matches nothing",
		storage: storage(
			'<ac:structured-macro ac:name="attachments"><ac:parameter ac:name="patterns">.*\\.pdf, (a+)+$, ^diagram</ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-empty", "No attachments."],
		absent: ["manual.pdf", "diagram.png", "notes.docx"],
	},
	{
		name: "anchor",
		storage:
			'<h2><ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">My Section</ac:parameter></ac:structured-macro>Title</h2><p><ac:link ac:anchor="My Section" /></p>',
		expect: ['id="wiki-anchor-my-section"', "#wiki-anchor-my-section"],
	},
	{
		name: "expand",
		storage: storage(
			'<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">More</ac:parameter><ac:rich-text-body><p>hidden body</p></ac:rich-text-body></ac:structured-macro>',
		),
		expect: ["wiki-expand", "<summary>More</summary>", "hidden body"],
	},
	{
		name: "details",
		storage: storage(
			'<ac:structured-macro ac:name="details"><ac:rich-text-body><tbody><tr><th>Owner</th><td>Team</td></tr></tbody></ac:rich-text-body></ac:structured-macro>',
		),
		expect: ["wiki-properties", "<th>Owner</th>", "<td>Team</td>"],
	},
	{
		name: "detailssummary",
		storage: storage(
			'<ac:structured-macro ac:name="detailssummary"><ac:parameter ac:name="heading">Report</ac:parameter><ac:parameter ac:name="columns">Owner</ac:parameter></ac:structured-macro>',
		),
		expect: ["wiki-properties-report", "Report", "Properties page"],
	},
];

beforeAll(async () => {
	await db.insert(pageAttachments).values([
		{
			sourceId: `wm-att-1-${run}`,
			pageId: (await createPage("Attachment holder", "<p>holder</p>")).id,
			fileName: "diagram.png",
			mimeType: "image/png",
			size: 1200,
			version: 1,
			storagePath: `aa/${run}`,
			sha256: "aa",
		},
	]);
});

test.each(macroCases)("macro $name renders", async (macroCase) => {
	const page = await createPage(`Macro ${macroCase.name}`, macroCase.storage);
	let childSourceId: string | undefined;
	if (macroCase.name === "children") {
		const child = await createPage("Macro child", "<p>child</p>", {
			parentId: page.id,
			position: 0,
		});
		childSourceId = child.sourceId;
	}
	if (macroCase.name === "contentbylabel") {
		await createPage("Featured page", "<p>featured</p>", {
			labels: ["featured"],
		});
	}
	if (macroCase.name === "detailssummary") {
		await createPage(
			"Properties page",
			'<ac:structured-macro ac:name="details"><ac:rich-text-body><tbody><tr><th>Owner</th><td>Team</td></tr></tbody></ac:rich-text-body></ac:structured-macro>',
		);
	}
	if (
		macroCase.name.startsWith("view-file") ||
		macroCase.name.startsWith("attachments")
	) {
		await db.insert(pageAttachments).values([
			{
				sourceId: `wm-png-${randomUUID()}`,
				pageId: page.id,
				fileName: "diagram.png",
				mimeType: "image/png",
				size: 1200,
				version: 1,
				storagePath: `bb/${randomUUID()}`,
				sha256: "bb",
			},
			{
				sourceId: `wm-pdf-${randomUUID()}`,
				pageId: page.id,
				fileName: "manual.pdf",
				mimeType: "application/pdf",
				size: 4200,
				version: 1,
				storagePath: `cc/${randomUUID()}`,
				sha256: "cc",
			},
			{
				sourceId: `wm-docx-${randomUUID()}`,
				pageId: page.id,
				fileName: "notes.docx",
				mimeType:
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				size: 900,
				version: 1,
				storagePath: `dd/${randomUUID()}`,
				sha256: "dd",
			},
		]);
	}
	if (macroCase.name === "contributors") {
		await db.insert(pageVersions).values({
			sourceId: `wm-version-${randomUUID()}`,
			pageId: page.id,
			number: 1,
			title: page.title,
			authorId: user.id,
			created: new Date(Date.UTC(2026, 0, 1)),
		});
	}

	const html = await render(page);
	expect(html).not.toContain("pageId=undefined");
	if (childSourceId) expect(html).toContain(`pageId=${childSourceId}`);
	for (const expected of macroCase.expect) {
		expect(
			html,
			`macro ${macroCase.name} should contain ${expected}`,
		).toContain(expected);
	}
	for (const absent of macroCase.absent ?? []) {
		expect(
			html,
			`macro ${macroCase.name} should not contain ${absent}`,
		).not.toContain(absent);
	}
	expect(html).not.toContain("<ac:");
	expect(html).not.toContain("<ri:");
});

test("space keys in macro parameters are case-insensitive", async () => {
	const page = await createPage(
		"Case space",
		storage(
			`<ac:structured-macro ac:name="recently-updated"><ac:parameter ac:name="spaces">${spaceKey.toLowerCase()}</ac:parameter><ac:parameter ac:name="max">100</ac:parameter></ac:structured-macro>`,
		),
	);
	const html = await render(page);
	expect(html).toContain(`pageId=${page.sourceId}`);
});

test("space type parameters select only spaces of that type", async () => {
	const personalKey = `WMP${run.slice(0, 3).toUpperCase()}`;
	const [personal] = await db
		.insert(spaces)
		.values({
			sourceId: `wm-personal-${run}`,
			key: personalKey,
			name: `Personal space ${run}`,
			type: "personal",
		})
		.returning();
	try {
		await createPage("Personal type page", "<p>personal</p>", {
			spaceId: personal.id,
		});
		await createPage("Global type page", "<p>global</p>");
		const page = await createPage(
			"Space type macro",
			storage(
				'<ac:structured-macro ac:name="recently-updated"><ac:parameter ac:name="spaces">@personal</ac:parameter><ac:parameter ac:name="max">100</ac:parameter></ac:structured-macro>',
			),
		);
		const html = await render(page);
		expect(html).toContain("Personal type page");
		expect(html).not.toContain("Global type page");
	} finally {
		await pool.query("delete from spaces where id = $1", [personal.id]);
	}
});

test("recently-updated with types=blogpost lists only blogposts", async () => {
	await createPage("Types normal page", "<p>normal</p>");
	await createPage("Types blog post", "<p>blog</p>", { type: "blogpost" });
	const page = await createPage(
		"Types macro page",
		storage(
			'<ac:structured-macro ac:name="recently-updated"><ac:parameter ac:name="types">blogpost</ac:parameter><ac:parameter ac:name="max">100</ac:parameter></ac:structured-macro>',
		),
	);
	const html = await render(page);
	expect(html).toContain("Types blog post");
	expect(html).not.toContain("Types normal page");
});

test("content by label shows the labels a page carries", async () => {
	await createPage("Alpha only page", "<p>alpha</p>", { labels: ["alpha"] });
	const page = await createPage(
		"Label macro page",
		storage(
			'<ac:structured-macro ac:name="contentbylabel"><ac:parameter ac:name="labels">alpha,beta</ac:parameter></ac:structured-macro>',
		),
	);
	const html = await render(page);
	expect(html).toContain('href="/label/alpha"');
	expect(html).not.toContain('href="/label/beta"');
});

test("widget links do not emit unsafe schemes", async () => {
	const page = await createPage("Unsafe widget", "<p>widget</p>");
	const html = await renderMacro(
		{
			name: "widget",
			params: { url: "javascript:alert(1)" },
			body: null,
			plain: null,
			raw: "",
			start: 0,
			end: 0,
		},
		await macroContext(page),
	);
	expect(html).not.toContain('href="javascript:');
	expect(html).toContain("javascript:alert(1)");
});

test("attachment patterns never run as regular expressions", async () => {
	const page = await createPage(
		"Long attachment name",
		storage(
			'<ac:structured-macro ac:name="attachments"><ac:parameter ac:name="patterns">(a+)+$, *a*a*a*a*a*a*a*a*a*a*a*b</ac:parameter></ac:structured-macro>',
		),
	);
	await db.insert(pageAttachments).values({
		sourceId: `wm-long-${randomUUID()}`,
		pageId: page.id,
		fileName: `${"a".repeat(30)}!`,
		mimeType: "text/plain",
		size: 1,
		version: 1,
		storagePath: `dd/${randomUUID()}`,
		sha256: "dd",
	});
	const started = performance.now();
	const html = await render(page);
	expect(performance.now() - started).toBeLessThan(1000);
	expect(html).toContain("No attachments.");
});

test("page properties report reads the editor's parameter names", async () => {
	await createPage(
		"Report labelled",
		'<ac:structured-macro ac:name="details"><ac:rich-text-body><tbody><tr><th>Owner</th><td>Team</td></tr></tbody></ac:rich-text-body></ac:structured-macro>',
		{ labels: ["report-label"] },
	);
	await createPage(
		"Report unlabelled",
		'<ac:structured-macro ac:name="details"><ac:rich-text-body><tbody><tr><th>Owner</th><td>Other</td></tr></tbody></ac:rich-text-body></ac:structured-macro>',
	);
	const page = await createPage(
		"Report macro",
		storage(
			'<ac:structured-macro ac:name="detailssummary"><ac:parameter ac:name="label">report-label</ac:parameter><ac:parameter ac:name="headings">Owner</ac:parameter><ac:parameter ac:name="firstcolumn">Page name</ac:parameter><ac:parameter ac:name="max">1</ac:parameter></ac:structured-macro>',
		),
	);
	const html = await render(page);
	expect(html).toContain("Report labelled");
	expect(html).not.toContain("Report unlabelled");
	expect(html).toContain("<th>Page name</th>");
	expect(html).toContain("<th>Owner</th>");
});

test("a macro renderer failure becomes an inline message", async () => {
	const page = await createPage(
		"Failing macro",
		storage(
			'<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">FAIL-1</ac:parameter></ac:structured-macro>',
		),
	);
	const original = macroRenderers.jira;
	macroRenderers.jira = () => {
		throw new Error("renderer exploded");
	};
	try {
		const html = await render(page);
		expect(html).toContain('class="wiki-unknown-macro"');
		expect(html).toContain("could not be rendered");
	} finally {
		macroRenderers.jira = original;
	}
});

test("unknown macros render a neutral placeholder naming the macro", async () => {
	const page = await createPage(
		"Unknown",
		storage(
			'<ac:structured-macro ac:name="noformat"><ac:parameter ac:name="size">large</ac:parameter></ac:structured-macro>',
		),
	);
	const html = await render(page);
	expect(html).toContain('class="wiki-unknown-macro"');
	expect(html).toContain("noformat");
	expect(html).not.toContain("ac:structured-macro");
	expect(html).not.toContain("ac:parameter");
});

test("macro names that exist on Object.prototype render the placeholder", async () => {
	for (const name of ["__proto__", "constructor", "toString"]) {
		const page = await createPage(
			`Prototype ${name}`,
			storage(`<ac:structured-macro ac:name="${name}" />`),
		);
		const html = await render(page);
		expect(html).toContain('class="wiki-unknown-macro"');
		expect(html).toContain(name);
	}
});

test("every macro in the table is registered by name", () => {
	for (const macroCase of macroCases) {
		const name = macroCase.name.split(" ")[0] as string;
		expect(macroNames()).toContain(name);
	}
});

test("macros nest: a panel inside a tip renders both", async () => {
	const page = await createPage(
		"Nested",
		storage(
			'<ac:structured-macro ac:name="tip"><ac:rich-text-body><p>outer</p><ac:structured-macro ac:name="note"><ac:rich-text-body><p>inner</p></ac:rich-text-body></ac:structured-macro></ac:rich-text-body></ac:structured-macro>',
		),
	);
	const html = await render(page);
	expect(html).toContain("wiki-panel-tip");
	expect(html).toContain("wiki-panel-note");
	expect(html).toContain("outer");
	expect(html).toContain("inner");
});

test("inline comment markers become highlighted spans", async () => {
	const page = await createPage(
		"Inline",
		'<p><ac:inline-comment-marker ac:ref="marker-1">highlighted</ac:inline-comment-marker></p>',
	);
	const html = await render(page);
	expect(html).toContain('class="wiki-inline-marker"');
	expect(html).toContain('data-marker="marker-1"');
	expect(html).toContain("highlighted");
});

test("task lists and layouts convert to HTML", async () => {
	const page = await createPage(
		"Tasks",
		'<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>done item</ac:task-body></ac:task><ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>open item</ac:task-body></ac:task></ac:task-list></ac:layout-cell><ac:layout-cell><p>second column</p></ac:layout-cell></ac:layout-section></ac:layout>',
	);
	const html = await render(page);
	expect(html).toContain("wiki-layout-two-equal");
	expect(html).toContain("wiki-task-complete");
	expect(html).toContain("done item");
	expect(html).toContain("open item");
	expect(html).toContain("second column");
});

test("attachments from storage format resolve to download URLs", async () => {
	const page = await createPage(
		"Image page",
		'<p><ac:image ac:alt="shot"><ri:attachment ri:filename="photo one.png" /></ac:image></p>',
	);
	await db.insert(pageAttachments).values({
		sourceId: `wm-img-${randomUUID()}`,
		pageId: page.id,
		fileName: "photo one.png",
		mimeType: "image/png",
		size: 10,
		version: 2,
		storagePath: `ee/${randomUUID()}`,
		sha256: "ee",
	});
	const html = await render(page);
	expect(html).toContain("/download/attachments/");
	expect(html).toContain("photo%20one.png");
	expect(html).toContain('alt="shot"');
});

test("raw iframes from storage are limited to the embed allow list", async () => {
	const page = await createPage(
		"Frames",
		'<p><iframe src="https://evil.test/x"></iframe><iframe src="https://www.youtube.com/embed/ok"></iframe><iframe src="/download/attachments/1/a.pdf"></iframe></p>',
	);
	const html = await render(page);
	expect(html).not.toContain('src="https://evil.test/x"');
	expect(html).toContain('href="https://evil.test/x"');
	expect(html).toContain('src="https://www.youtube.com/embed/ok"');
	expect(html).toContain('src="/download/attachments/1/a.pdf"');
});

test("page property lookup fills its limit from pages that have property rows", async () => {
	const access = await loadWikiAccess(user);
	await createPage(
		"000 Empty properties",
		'<ac:structured-macro ac:name="details"><ac:rich-text-body><p>no rows</p></ac:rich-text-body></ac:structured-macro>',
	);
	await createPage(
		"001 Properties page",
		'<ac:structured-macro ac:name="details"><ac:rich-text-body><tbody><tr><th>Owner</th><td>Team</td></tr></tbody></ac:rich-text-body></ac:structured-macro>',
	);
	const rows = await pagesWithProperties(access, [space.id], 1);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.values.get("Owner")).toBe("Team");
});

test("a rich link body renders as text, not as escaped markup", async () => {
	const page = await createPage(
		"Rich link",
		'<p><ac:link><ri:url ri:value="https://example.test/page" /><ac:link-body>go <strong>home</strong></ac:link-body></ac:link></p>',
	);
	const html = await render(page);
	expect(html).toContain('href="https://example.test/page"');
	expect(html).toContain("go home");
	expect(html).not.toContain("&lt;strong&gt;");
});

test("a self-closing image does not swallow the content after it", async () => {
	const page = await createPage(
		"Self-closing image",
		'<p><ac:image ac:alt="self" /><strong>kept text</strong><ac:image ac:alt="later"><ri:attachment ri:filename="later.png" /></ac:image></p>',
	);
	const html = await render(page);
	expect(html).toContain("kept text");
});

test("draft and trashed pages are not listed in the tree", async () => {
	const parent = await createPage("Tree parent", "<p>parent</p>");
	await createPage("Tree child", "<p>child</p>", { parentId: parent.id });
	await createPage("Tree draft", "<p>draft</p>", {
		parentId: parent.id,
		status: "draft",
	});
	const roots = await db
		.select()
		.from(pages)
		.where(eq(pages.parentId, parent.id));
	expect(roots.length).toBe(2);
});
