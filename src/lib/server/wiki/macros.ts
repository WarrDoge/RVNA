import { and, eq, inArray, sql } from "drizzle-orm";
import { isRasterImageType } from "#lib/shared/served-type.ts";
import { attachmentUrl, formatSize } from "#lib/wiki/format.ts";
import { JqlError } from "../../shared/jql/index.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import type { SearchUser } from "../jql/compile.ts";
import { pages, spaces } from "../schema.ts";
import {
	type AttachmentRow,
	childPageLinks,
	issueSummary,
	jqlTable,
	type PageLink,
	pageContributors,
	pagesWithLabels,
	pagesWithProperties,
	pageUrl,
	popularLabels,
	recentPageLinks,
} from "./data.ts";
import type { WikiAccess } from "./permissions.ts";
import {
	type AttachmentRef,
	anchorId,
	escapeHtml,
	iframeHosts,
	type ParsedMacro,
	type StorageContext,
	searchFormAction,
	stripTags,
} from "./storage.ts";

export interface MacroPage {
	id: string;
	sourceId: string;
	spaceId: string;
	title: string;
}

export interface MacroSpace {
	id: string;
	key: string;
	name: string;
	type: "global" | "personal";
}

export interface MacroContext {
	user: CurrentUser;
	access: WikiAccess;
	page: MacroPage;
	space: MacroSpace;
	storage: StorageContext;
	renderBody: (storage: string) => Promise<string>;
	searchUser: SearchUser | null;
}

export type MacroRenderer = (
	macro: ParsedMacro,
	ctx: MacroContext,
) => Promise<string> | string;

const monthNames = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export function formatDay(value: string | null): string {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return `${date.getUTCDate()} ${monthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function integerParam(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number,
) {
	const parsed = Number.parseInt(value ?? "", 10);
	if (Number.isNaN(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}

function booleanParam(value: string | undefined, fallback = false) {
	if (value === undefined) return fallback;
	return value === "true" || value === "1";
}

async function spaceIdsForParameter(
	ctx: MacroContext,
	value: string | undefined,
): Promise<string[]> {
	const readable = [...ctx.access.readableSpaceIds];
	if (readable.length === 0) return [];
	const tokens = (value ?? "@self")
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean);
	if (tokens.length === 0) return [ctx.space.id];
	if (tokens.includes("@all")) return readable;

	const selected = new Set<string>();
	const keys = tokens.filter((token) => !token.startsWith("@"));
	if (keys.length > 0) {
		const rows = await db
			.select({ id: spaces.id })
			.from(spaces)
			.where(
				and(
					inArray(
						sql`lower(${spaces.key})`,
						keys.map((key) => key.toLowerCase()),
					),
					inArray(spaces.id, readable),
				),
			);
		for (const row of rows) selected.add(row.id);
	}
	if (tokens.includes("@self")) selected.add(ctx.space.id);

	const types = tokens
		.filter((token) => token === "@global" || token === "@personal")
		.map((token) => token.slice(1) as "global" | "personal");
	if (types.length > 0) {
		const rows = await db
			.select({ id: spaces.id })
			.from(spaces)
			.where(and(inArray(spaces.id, readable), inArray(spaces.type, types)));
		for (const row of rows) selected.add(row.id);
	}

	if (selected.size > 0) return [...selected];
	return keys.length > 0 || types.length > 0 ? [] : [ctx.space.id];
}

function pageLinkItem(link: PageLink, options: { showSpace?: boolean } = {}) {
	const space =
		options.showSpace === false
			? ""
			: `<span class="wiki-list-space">${escapeHtml(link.spaceName)}</span>`;
	const updated = link.updated
		? `<span class="wiki-list-date">${escapeHtml(formatDay(link.updated))}</span>`
		: "";
	return `<li class="wiki-list-item"><a href="${escapeHtml(pageUrl(link.sourceId))}">${escapeHtml(link.title)}</a>${space}${updated}</li>`;
}

const toc: MacroRenderer = (macro) => {
	const min = integerParam(macro.params.minLevel, 1, 1, 6);
	const max = integerParam(macro.params.maxLevel, 6, 1, 6);
	const low = Math.min(min, max);
	const high = Math.max(min, max);
	return `<div class="wiki-toc" data-min-level="${low}" data-max-level="${high}"><div class="wiki-toc-title">Contents</div></div>`;
};

const code: MacroRenderer = (macro) => {
	const title = macro.params.title;
	const language = macro.params.language ?? "";
	const linenumbers = booleanParam(macro.params.linenumbers);
	const collapse = booleanParam(macro.params.collapse);
	const firstLine = integerParam(macro.params.firstline, 1, 1, 100_000);
	const source = macro.plain ?? "";
	const lines = source.replace(/\n$/, "").split("\n");

	const body = linenumbers
		? `<pre class="wiki-code-pre"><code>${lines
				.map(
					(line, index) =>
						`<span class="wiki-code-line"><span class="wiki-code-number">${index + firstLine}</span><span class="wiki-code-text">${escapeHtml(line) || "&nbsp;"}</span></span>`,
				)
				.join("\n")}</code></pre>`
		: `<pre class="wiki-code-pre"><code class="language-${escapeHtml(language)}">${escapeHtml(source)}</code></pre>`;

	const heading =
		title || language
			? `<div class="wiki-code-head"><span class="wiki-code-title">${escapeHtml(title ?? "")}</span><span class="wiki-code-language">${escapeHtml(language)}</span></div>`
			: "";

	if (collapse) {
		return `<div class="wiki-code" data-macro="code"><details class="wiki-code-collapsed"><summary>${escapeHtml(title ?? "Show code")}</summary>${body}</details></div>`;
	}
	return `<div class="wiki-code" data-macro="code">${heading}${body}</div>`;
};

const panelIcons: Record<string, string> = {
	info: "\u2139\ufe0f",
	tip: "\u{1f4a1}",
	note: "\u{1f4dd}",
	warning: "\u26a0\ufe0f",
	panel: "",
};

function panelMacro(kind: string): MacroRenderer {
	return async (macro, ctx) => {
		const title = macro.params.title ?? macro.params.Title ?? "";
		const body = macro.body ? await ctx.renderBody(macro.body) : "";
		const icon = panelIcons[kind] ?? "";
		const heading = title
			? `<span class="wiki-panel-title">${escapeHtml(title)}</span>`
			: "";
		return `<div class="wiki-panel wiki-panel-${kind}" data-macro="${kind}"><div class="wiki-panel-head"><span class="wiki-panel-icon" aria-hidden="true">${icon}</span>${heading}</div><div class="wiki-panel-body">${body}</div></div>`;
	};
}

const children: MacroRenderer = async (macro, ctx) => {
	const targetTitle = macro.params.page;
	let parentId = ctx.page.id;
	if (targetTitle) {
		const [row] = await db
			.select({ id: pages.id })
			.from(pages)
			.where(
				and(
					eq(pages.spaceId, ctx.space.id),
					eq(pages.title, targetTitle),
					eq(pages.status, "current"),
				),
			)
			.limit(1);
		if (row) parentId = row.id;
	}

	const links = await childPageLinks(ctx.access, parentId, {
		depth: integerParam(macro.params.depth, 1, 1, 10),
		sort: macro.params.sort,
		reverse: booleanParam(macro.params.reverse),
		limit: integerParam(macro.params.first, 500, 1, 500),
	});
	if (links.length === 0) {
		return `<div class="wiki-children wiki-empty" data-macro="children">No child pages.</div>`;
	}
	const items = links
		.map((link) => {
			const level = link.level ?? 1;
			return `<li class="wiki-child wiki-child-level-${level}"><a href="${escapeHtml(pageUrl(link.sourceId))}">${escapeHtml(link.title)}</a></li>`;
		})
		.join("");
	return `<div class="wiki-children" data-macro="children"><ul class="wiki-list">${items}</ul></div>`;
};

function jiraLozenge(issue: Awaited<ReturnType<typeof issueSummary>>) {
	if (!issue) return "";
	const category = issue.category;
	return `<span class="wiki-jira-issue"><span class="wiki-jira-type">${escapeHtml(issue.type)}</span><a class="wiki-jira-key" href="/browse/${escapeHtml(issue.key)}">${escapeHtml(issue.key)}</a><span class="wiki-jira-summary">${escapeHtml(issue.summary)}</span><span class="wiki-lozenge wiki-lozenge-${category}">${escapeHtml(issue.status)}</span></span>`;
}

const jira: MacroRenderer = async (macro, ctx) => {
	const key = macro.params.key?.trim();
	if (key) {
		const issue = await issueSummary(key, ctx.searchUser);
		if (!issue) {
			return `<div class="wiki-unknown-macro" data-macro="jira">Issue <strong>${escapeHtml(key)}</strong> was not found.</div>`;
		}
		return `<span class="wiki-macro wiki-jira" data-macro="jira">${jiraLozenge(issue)}</span>`;
	}

	const jql = macro.params.jql?.trim();
	if (!jql) {
		return `<div class="wiki-unknown-macro" data-macro="jira">The issue list macro needs an issue key or a query.</div>`;
	}
	const columns = (macro.params.columns ?? "key,summary,type,status,assignee")
		.split(",")
		.map((column) => column.trim().toLowerCase())
		.filter(Boolean);
	const limit = integerParam(macro.params.maximumIssues, 20, 1, 100);
	const table = await jqlTable(jql, columns, ctx.searchUser, limit);
	if ("error" in table) {
		return `<div class="wiki-unknown-macro" data-macro="jira">${escapeHtml(table.error)}</div>`;
	}
	const head = table.columns
		.map((column) => `<th>${escapeHtml(column)}</th>`)
		.join("");
	const rows = table.rows
		.map(
			(row) =>
				`<tr>${table.columns
					.map((column, index) => {
						const value = row.values[index] ?? "";
						if (column === "key") {
							return `<td><a href="/browse/${escapeHtml(value)}">${escapeHtml(value)}</a></td>`;
						}
						return `<td>${escapeHtml(value)}</td>`;
					})
					.join("")}</tr>`,
		)
		.join("");
	return `<div class="wiki-macro wiki-jira-table" data-macro="jira"><table class="wiki-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
};

function fileCard(
	pageSourceId: string,
	attachment: Pick<AttachmentRow, "fileName" | "size" | "version" | "mimeType">,
) {
	const url = attachmentUrl(
		pageSourceId,
		attachment.fileName,
		attachment.version,
	);
	return `<div class="wiki-file"><span class="wiki-file-icon" aria-hidden="true">\u{1f4ce}</span><a class="wiki-file-name" href="${escapeHtml(url)}">${escapeHtml(attachment.fileName)}</a><span class="wiki-file-size">${escapeHtml(formatSize(attachment.size))}</span></div>`;
}

const viewFile: MacroRenderer = async (macro, ctx) => {
	const name =
		macro.params.name?.trim() ||
		macro.params.title?.trim() ||
		macro.params.filename?.trim();
	if (!name) {
		return `<div class="wiki-unknown-macro" data-macro="view-file">The view-file macro needs a file name.</div>`;
	}
	const attachment: AttachmentRef | undefined =
		ctx.storage.attachments.get(name);
	if (!attachment) {
		return `<div class="wiki-file wiki-file-missing"><span class="wiki-file-icon" aria-hidden="true">\u{1f4ce}</span><span class="wiki-file-name">${escapeHtml(name)}</span><span class="wiki-file-size">missing attachment</span></div>`;
	}
	const height = integerParam(macro.params.height, 480, 120, 2000);
	const mime = (attachment.mimeType ?? "").toLowerCase();
	if (isRasterImageType(mime)) {
		const url = attachmentUrl(
			ctx.page.sourceId,
			name,
			attachment.version,
			true,
		);
		return `<figure class="wiki-file-preview" data-macro="view-file"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" /><figcaption>${escapeHtml(name)}</figcaption></figure>`;
	}
	if (mime === "application/pdf") {
		const url = attachmentUrl(
			ctx.page.sourceId,
			name,
			attachment.version,
			true,
		);
		return `<div class="wiki-file-preview wiki-file-pdf" data-macro="view-file"><iframe src="${escapeHtml(url)}" title="${escapeHtml(name)}" height="${height}" loading="lazy"></iframe><div class="wiki-file-caption"><a href="${escapeHtml(attachmentUrl(ctx.page.sourceId, name, attachment.version))}">${escapeHtml(name)}</a></div></div>`;
	}
	return `<div class="wiki-macro" data-macro="view-file">${fileCard(ctx.page.sourceId, { ...attachment, fileName: name })}</div>`;
};

const recentlyUpdated: MacroRenderer = async (macro, ctx) => {
	const limit = integerParam(macro.params.max, 15, 1, 100);
	const spaceIds = await spaceIdsForParameter(ctx, macro.params.spaces);
	const requestedTypes = (macro.params.types ?? "")
		.split(",")
		.map((type) => type.trim().toLowerCase())
		.filter(Boolean);
	const wantsPage = requestedTypes.includes("page");
	const wantsBlogpost = requestedTypes.includes("blogpost");
	const type =
		wantsPage === wantsBlogpost ? undefined : wantsPage ? "page" : "blogpost";
	const links = await recentPageLinks(ctx.access, spaceIds, { limit, type });
	const hideHeading = booleanParam(macro.params.hideHeading);
	const heading = hideHeading
		? ""
		: `<div class="wiki-macro-head">Recently updated</div>`;
	const items = links
		.map((link) => pageLinkItem(link, { showSpace: spaceIds.length > 1 }))
		.join("");
	return `<div class="wiki-recent" data-macro="recently-updated">${heading}<ul class="wiki-list">${items || '<li class="wiki-list-empty">No pages yet.</li>'}</ul></div>`;
};

const contentByLabel: MacroRenderer = async (macro, ctx) => {
	const labels = (macro.params.labels ?? "")
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean);
	if (labels.length === 0) {
		return `<div class="wiki-unknown-macro" data-macro="contentbylabel">The content by label macro needs at least one label.</div>`;
	}
	const spaceIds = await spaceIdsForParameter(ctx, macro.params.spaces);
	const links = await pagesWithLabels(ctx.access, labels, spaceIds, {
		limit: integerParam(macro.params.max, 50, 1, 200),
		matchAll: (macro.params.operator ?? "or").toLowerCase() === "and",
	});
	if (macro.params.sort === "title") {
		links.sort((left, right) => left.title.localeCompare(right.title));
	}
	const showLabels = booleanParam(macro.params.showLabels, true);
	const items = links
		.map((link) => {
			const base = pageLinkItem(link, {
				showSpace: booleanParam(macro.params.showSpace, spaceIds.length > 1),
			});
			if (!showLabels) return base;
			const labelList = [...(link.labels ?? [])]
				.sort((left, right) => left.localeCompare(right))
				.map(
					(label) =>
						`<a class="wiki-label" href="/label/${encodeURIComponent(label)}">${escapeHtml(label)}</a>`,
				)
				.join("");
			return base.replace(
				"</li>",
				`<span class="wiki-labels">${labelList}</span></li>`,
			);
		})
		.join("");
	return `<div class="wiki-labeled" data-macro="contentbylabel"><div class="wiki-macro-head">Content by label: ${labels.map((label) => escapeHtml(label)).join(", ")}</div><ul class="wiki-list">${items || '<li class="wiki-list-empty">No pages match these labels.</li>'}</ul></div>`;
};

const livesearch: MacroRenderer = (macro, ctx) => {
	const spaceKey = macro.params.spaceKey?.trim() || ctx.space.key;
	const placeholder = macro.params.placeholder?.trim() || "Search this space";
	return `<div class="wiki-livesearch" data-macro="livesearch"><form method="GET" action="${searchFormAction}" role="search"><input type="hidden" name="space" value="${escapeHtml(spaceKey)}" /><input type="search" name="queryString" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" /><button type="submit">Search</button></form></div>`;
};

const popularLabelsMacro: MacroRenderer = async (macro, ctx) => {
	const limit = integerParam(macro.params.count, 100, 1, 500);
	const requested = macro.params.spaceKey?.trim();
	let spaceIds = [...ctx.access.readableSpaceIds];
	if (requested) {
		spaceIds =
			spaceIds.length === 0
				? []
				: (
						await db
							.select({ id: spaces.id })
							.from(spaces)
							.where(
								and(eq(spaces.key, requested), inArray(spaces.id, spaceIds)),
							)
					).map((row) => row.id);
	}
	const rows = await popularLabels(ctx.access, spaceIds, limit);
	const items = rows
		.map(
			(row) =>
				`<li class="wiki-list-item"><a class="wiki-label" href="/label/${encodeURIComponent(row.label)}">${escapeHtml(row.label)}</a><span class="wiki-list-date">${row.count}</span></li>`,
		)
		.join("");
	return `<div class="wiki-popular-labels" data-macro="popular-labels"><ul class="wiki-list">${items || '<li class="wiki-list-empty">No labels yet.</li>'}</ul></div>`;
};

const createFromTemplate: MacroRenderer = (macro, ctx) => {
	const label = macro.params.buttonLabel?.trim() || "Create from template";
	const spaceKey = macro.params.spaceKey?.trim() || ctx.space.key;
	const params = new URLSearchParams({ spaceKey });
	if (spaceKey === ctx.space.key) params.set("fromPageId", ctx.page.id);
	const title = macro.params.title?.trim();
	if (title) params.set("title", title);
	return `<div class="wiki-create-from-template" data-macro="create-from-template"><a class="wiki-button" href="/pages/createpage.action?${params.toString()}">${escapeHtml(label)}</a></div>`;
};

const contributors: MacroRenderer = async (macro, ctx) => {
	const rows = await pageContributors(ctx.access, ctx.page.id, {
		limit: integerParam(macro.params.limit, 10, 1, 50),
		order: macro.params.order,
	});
	const showLastTime = booleanParam(macro.params.showLastTime);
	const showCount = booleanParam(macro.params.showCount, true);
	const items = rows
		.map((row) => {
			const count = showCount
				? `<span class="wiki-contributor-count">${row.count}</span>`
				: "";
			const last = showLastTime
				? `<span class="wiki-list-date">${escapeHtml(formatDay(row.lastUpdate))}</span>`
				: "";
			return `<li class="wiki-contributor"><span class="wiki-contributor-name">${escapeHtml(row.displayName)}</span>${count}${last}</li>`;
		})
		.join("");
	return `<div class="wiki-contributors" data-macro="contributors"><ul class="wiki-list wiki-list-inline">${items || '<li class="wiki-list-empty">No contributors yet.</li>'}</ul></div>`;
};

function httpUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return url;
	} catch {
		return null;
	}
}

function allowedIframeUrl(value: string): boolean {
	const url = httpUrl(value);
	return url !== null && iframeHosts.includes(url.hostname);
}

const widget: MacroRenderer = (macro) => {
	const url = macro.params.url?.trim();
	if (!url) {
		return `<div class="wiki-unknown-macro" data-macro="widget">The widget macro needs a URL.</div>`;
	}
	const width = integerParam(macro.params.width, 640, 160, 2000);
	const height = integerParam(macro.params.height, 360, 120, 2000);
	if (allowedIframeUrl(url)) {
		return `<div class="wiki-widget" data-macro="widget"><iframe src="${escapeHtml(url)}" title="Embedded content" width="${width}" height="${height}" loading="lazy" allowfullscreen></iframe></div>`;
	}
	const parsed = httpUrl(url);
	const relative = url.startsWith("/") || url.startsWith("#");
	if (!parsed && !relative) {
		return `<div class="wiki-widget wiki-widget-link" data-macro="widget"><span class="wiki-widget-url">${escapeHtml(url)}</span></div>`;
	}
	const label = parsed?.hostname ?? url;
	return `<div class="wiki-widget wiki-widget-link" data-macro="widget"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a><span class="wiki-widget-url">${escapeHtml(url)}</span></div>`;
};

const attachments: MacroRenderer = async (macro, ctx) => {
	const patterns = (macro.params.patterns ?? "")
		.split(",")
		.map((pattern) => pattern.trim())
		.filter(Boolean);
	const matchers = patterns
		.map((pattern) => {
			try {
				return new RegExp(pattern, "i");
			} catch {
				return null;
			}
		})
		.filter((matcher): matcher is RegExp => matcher !== null);
	const rows = [...ctx.storage.attachments.values()]
		.filter(
			(attachment) =>
				patterns.length === 0 ||
				matchers.some((matcher) => matcher.test(attachment.fileName)),
		)
		.sort((left, right) => left.fileName.localeCompare(right.fileName));
	if (rows.length === 0) {
		return `<div class="wiki-attachments wiki-empty" data-macro="attachments">No attachments.</div>`;
	}
	const body = rows
		.map(
			(attachment) =>
				`<tr><td><a href="${escapeHtml(attachmentUrl(ctx.page.sourceId, attachment.fileName, attachment.version))}">${escapeHtml(attachment.fileName)}</a></td><td>${escapeHtml(formatSize(attachment.size))}</td><td>${attachment.version}</td></tr>`,
		)
		.join("");
	return `<div class="wiki-attachments" data-macro="attachments"><table class="wiki-table"><thead><tr><th>Name</th><th>Size</th><th>Version</th></tr></thead><tbody>${body}</tbody></table></div>`;
};

const anchor: MacroRenderer = (macro) => {
	const name = macro.params.name ?? macro.params[""] ?? macro.body ?? "";
	const label = stripTags(name);
	if (!label) return "";
	return `<a class="wiki-anchor" id="${escapeHtml(anchorId(label))}"></a>`;
};

const expand: MacroRenderer = async (macro, ctx) => {
	const title = macro.params.title ?? "Click here to expand";
	const body = macro.body ? await ctx.renderBody(macro.body) : "";
	return `<details class="wiki-expand" data-macro="expand"><summary>${escapeHtml(title)}</summary><div class="wiki-expand-body">${body}</div></details>`;
};

const details: MacroRenderer = async (macro, ctx) => {
	const body = macro.body ? await ctx.renderBody(macro.body) : "";
	return `<div class="wiki-properties" data-macro="details"><table class="wiki-table wiki-properties-table">${body}</table></div>`;
};

const detailsSummary: MacroRenderer = async (macro, ctx) => {
	const labels = (macro.params.label ?? macro.params.labels ?? "")
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean);
	const spaceIds = await spaceIdsForParameter(
		ctx,
		macro.params.spaces ?? macro.params.spaceAndPage,
	);
	const max = integerParam(macro.params.max, 200, 1, 200);
	let rows = await pagesWithProperties(
		ctx.access,
		spaceIds,
		labels.length > 0 ? 200 : max,
	);
	if (labels.length > 0) {
		const allowed = new Set(
			(await pagesWithLabels(ctx.access, labels, spaceIds, { limit: 200 })).map(
				(page) => page.id,
			),
		);
		rows = rows.filter((row) => allowed.has(row.id)).slice(0, max);
	}

	const requested = (macro.params.headings ?? macro.params.columns ?? "")
		.split(",")
		.map((column) => column.trim())
		.filter(Boolean);
	const columns =
		requested.length > 0
			? requested
			: [...new Set(rows.flatMap((row) => [...row.values.keys()]))].slice(0, 8);
	const firstColumn = macro.params.firstcolumn?.trim() || "Title";
	const heading = macro.params.heading ?? "Page properties report";
	const head = `<th>${escapeHtml(firstColumn)}</th>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}`;
	const body = rows
		.map(
			(row) =>
				`<tr><td><a href="${escapeHtml(pageUrl(row.sourceId))}">${escapeHtml(row.title)}</a></td>${columns
					.map(
						(column) => `<td>${escapeHtml(row.values.get(column) ?? "")}</td>`,
					)
					.join("")}</tr>`,
		)
		.join("");
	return `<div class="wiki-properties-report" data-macro="detailssummary"><div class="wiki-macro-head">${escapeHtml(heading)}</div><table class="wiki-table"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length + 1}">No pages found.</td></tr>`}</tbody></table></div>`;
};

function unknownMacro(macro: ParsedMacro) {
	return `<div class="wiki-unknown-macro" data-macro="${escapeHtml(macro.name)}">Unknown macro: <strong>${escapeHtml(macro.name)}</strong></div>`;
}

export const macroRenderers: Record<string, MacroRenderer> = {
	toc,
	code,
	info: panelMacro("info"),
	tip: panelMacro("tip"),
	note: panelMacro("note"),
	warning: panelMacro("warning"),
	panel: panelMacro("panel"),
	children,
	jira,
	"view-file": viewFile,
	viewpdf: viewFile,
	viewdoc: viewFile,
	viewppt: viewFile,
	viewxls: viewFile,
	viewzip: viewFile,
	"recently-updated": recentlyUpdated,
	contentbylabel: contentByLabel,
	"popular-labels": popularLabelsMacro,
	livesearch,
	"create-from-template": createFromTemplate,
	contributors,
	widget,
	attachments,
	anchor,
	expand,
	details,
	detailssummary: detailsSummary,
};

export function macroNames() {
	return Object.keys(macroRenderers);
}

export async function renderMacro(
	macro: ParsedMacro,
	ctx: MacroContext,
): Promise<string> {
	const renderer = Object.hasOwn(macroRenderers, macro.name)
		? macroRenderers[macro.name]
		: undefined;
	if (!renderer) return unknownMacro(macro);
	try {
		return await renderer(macro, ctx);
	} catch (error) {
		if (error instanceof JqlError) {
			return `<div class="wiki-unknown-macro" data-macro="${escapeHtml(macro.name)}">${escapeHtml(error.jiraMessage)}</div>`;
		}
		console.error(`wiki macro ${macro.name} failed`, error);
		return `<div class="wiki-unknown-macro" data-macro="${escapeHtml(macro.name)}">This macro could not be rendered.</div>`;
	}
}
