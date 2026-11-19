import sanitizeHtml from "sanitize-html";
import { withSafeRel } from "../html.ts";

export interface ParsedMacro {
	name: string;
	params: Record<string, string>;
	/** Inner storage of the macro's rich-text body, or null. */
	body: string | null;
	/** Text of the macro's plain-text body (code, noformat), or null. */
	plain: string | null;
	raw: string;
	start: number;
	end: number;
}

export interface AttachmentRef {
	id: string;
	fileName: string;
	version: number;
	mimeType: string | null;
	size: number;
}

export interface StorageContext {
	pageSourceId: string;
	/** Key of the page's own space. */
	spaceKey: string;
	/** Latest version of every attachment on the page, keyed by file name. */
	attachments: Map<string, AttachmentRef>;
	/** Resolves the source id of a page in the same space by title. */
	pageSourceIdByTitle: Map<string, string>;
	/** Pages of the other spaces the body links to, keyed by `otherSpacePageKey`. */
	otherSpacePages: Map<string, string>;
	/** Resolves the attachment marker of an inline comment to its comment id. */
	inlineMarkers: Set<string>;
}

/** Space keys are case-insensitive in Confluence links. */
export const otherSpacePageKey = (spaceKey: string, title: string) =>
	`${spaceKey.toLowerCase()}\n${title}`;

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
};

export function anchorId(name: string): string {
	const slug = name
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	return `wiki-anchor-${slug || "anchor"}`;
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function codePoint(value: number): string | null {
	if (
		!Number.isInteger(value) ||
		value < 0 ||
		value > 0x10ffff ||
		(value >= 0xd800 && value <= 0xdfff)
	) {
		return null;
	}
	return String.fromCodePoint(value);
}

export function decodeEntities(value: string): string {
	return value
		.replace(/&#(\d+);/g, (match, code: string) => {
			const decoded = codePoint(Number(code));
			return decoded ?? match;
		})
		.replace(/&#x([0-9a-f]+);/gi, (match, code: string) => {
			const decoded = codePoint(Number.parseInt(code, 16));
			return decoded ?? match;
		})
		.replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name] ?? match);
}

export function stripTags(value: string): string {
	return decodeEntities(value.replace(/<[^>]*>/g, "")).trim();
}

function tagEnd(source: string, start: number): number {
	let quote: string | null = null;
	for (let index = start; index < source.length; index++) {
		const character = source[index];
		if (quote) {
			if (character === quote) quote = null;
		} else if (character === '"' || character === "'") {
			quote = character;
		} else if (character === ">") {
			return index;
		}
	}
	return -1;
}

function attribute(tag: string, name: string): string | null {
	const quoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
	if (quoted) return decodeEntities(quoted[1]);
	const single = tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`));
	return single ? decodeEntities(single[1]) : null;
}

type MacroKind = "structured" | "old";

const macroTag =
	/<ac:(structured-)?macro(?=[\s/>])|<\/ac:(structured-)?macro>/g;

interface MacroRange {
	start: number;
	openEnd: number;
	/** Index of the close tag; equals `openEnd` for a self-closing macro. */
	closeAt: number;
	end: number;
}

/**
 * Matches every macro open tag with its close tag in one pass. A page author
 * controls the body, so the scan must stay linear on unclosed or crossed tags.
 */
function matchMacroTags(source: string): MacroRange[] {
	const ranges: MacroRange[] = [];
	const stack: { kind: MacroKind; start: number; openEnd: number }[] = [];
	const open: Record<MacroKind, number[]> = { structured: [], old: [] };
	macroTag.lastIndex = 0;
	for (;;) {
		const match = macroTag.exec(source);
		if (!match) break;
		if (match[0].startsWith("</")) {
			const at = open[match[2] ? "structured" : "old"].pop();
			if (at === undefined) continue;
			// Opens above the matched one are unclosed macros of the other kind.
			while (stack.length > at + 1) {
				const dropped = stack.pop();
				if (dropped) open[dropped.kind].pop();
			}
			const entry = stack.pop();
			if (!entry) continue;
			ranges.push({
				start: entry.start,
				openEnd: entry.openEnd,
				closeAt: match.index,
				end: match.index + match[0].length,
			});
			continue;
		}
		const openEnd = tagEnd(source, match.index);
		if (openEnd === -1) break;
		macroTag.lastIndex = openEnd + 1;
		if (source[openEnd - 1] === "/") {
			ranges.push({
				start: match.index,
				openEnd,
				closeAt: openEnd,
				end: openEnd + 1,
			});
			continue;
		}
		const kind: MacroKind = match[1] ? "structured" : "old";
		open[kind].push(stack.length);
		stack.push({ kind, start: match.index, openEnd });
	}
	return ranges.sort((left, right) => left.start - right.start);
}

function parameterValue(raw: string): string {
	const url = raw.match(/<ri:url\b[^>]*\bri:value="([^"]*)"/);
	if (url) return decodeEntities(url[1]);
	const attachment = raw.match(/<ri:attachment\b[^>]*\bri:filename="([^"]*)"/);
	if (attachment) return decodeEntities(attachment[1]);
	const page = raw.match(/<ri:page\b[^>]*\bri:content-title="([^"]*)"/);
	if (page) return decodeEntities(page[1]);
	const user = raw.match(/<ri:user\b[^>]*\bri:(?:username|userkey)="([^"]*)"/);
	if (user) return decodeEntities(user[1]);
	return stripTags(raw.replace(/<!\[CDATA\[|\]\]>/g, ""));
}

export function parseParameters(inner: string): Record<string, string> {
	const params: Record<string, string> = {};
	const pattern =
		/<ac:parameter\b([^>]*)>([\s\S]*?)<\/ac:parameter>|<ac:parameter\b([^>]*)\/>/g;
	for (const match of inner.matchAll(pattern)) {
		const tag = match[1] ?? match[3] ?? "";
		const name = attribute(tag, "ac:name");
		if (name === null) continue;
		params[name] = match[2] === undefined ? "" : parameterValue(match[2]);
	}
	return params;
}

/** Every top-level macro (structured or legacy `ac:macro`) in document order. */
export function findMacros(source: string): ParsedMacro[] {
	const macros: ParsedMacro[] = [];
	let covered = 0;
	for (const range of matchMacroTags(source)) {
		if (range.start < covered) continue;
		covered = range.end;
		const name = attribute(
			source.slice(range.start, range.openEnd + 1),
			"ac:name",
		);
		if (name === null) continue;
		const raw = source.slice(range.start, range.end);
		if (range.closeAt === range.openEnd) {
			macros.push({
				name,
				params: {},
				body: null,
				plain: null,
				raw,
				start: range.start,
				end: range.end,
			});
			continue;
		}
		const inner = source.slice(range.openEnd + 1, range.closeAt);
		const rich = inner.match(
			/<ac:rich-text-body>([\s\S]*)<\/ac:rich-text-body>/,
		);
		const plain = inner.match(
			/<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>/,
		);
		macros.push({
			name,
			params: parseParameters(inner),
			body: rich ? rich[1] : null,
			plain: plain
				? decodeEntities(plain[1].replace(/<!\[CDATA\[|\]\]>/g, ""))
				: null,
			raw,
			start: range.start,
			end: range.end,
		});
	}
	return macros;
}

const emoticons: Record<string, string> = {
	tick: "\u2705",
	cross: "\u274c",
	warning: "\u26a0\ufe0f",
	plus: "\u2795",
	minus: "\u2796",
	question: "\u2753",
	info: "\u2139\ufe0f",
	smile: "U0001f642",
	sad: "U0001f641",
	cheeky: "U0001f61b",
	laugh: "U0001f604",
	thumbs_up: "U0001f44d",
	thumbs_down: "U0001f44e",
	heart: "\u2764\ufe0f",
	lightbulb: "U0001f4a1",
	star_yellow: "\u2b50",
	music: "U0001f3b5",
};

const layoutClasses: Record<string, string> = {
	single: "wiki-layout-single",
	two_equal: "wiki-layout-two-equal",
	two_left_sidebar: "wiki-layout-two-left",
	two_right_sidebar: "wiki-layout-two-right",
	three_equal: "wiki-layout-three-equal",
	three_with_sidebars: "wiki-layout-three-sidebars",
};

function attachmentUrl(
	ctx: StorageContext,
	fileName: string,
	pageSourceId = ctx.pageSourceId,
): string | null {
	const attachment = ctx.attachments.get(fileName);
	if (!attachment) return null;
	return `/download/attachments/${pageSourceId}/${encodeURIComponent(fileName)}?version=${attachment.version}`;
}

function renderImage(attributes: string, inner: string, ctx: StorageContext) {
	const fileName = inner.match(
		/<ri:attachment\b[^>]*\bri:filename="([^"]*)"/,
	)?.[1];
	const url = inner.match(/<ri:url\b[^>]*\bri:value="([^"]*)"/)?.[1];
	const src = fileName
		? attachmentUrl(ctx, decodeEntities(fileName))
		: url
			? decodeEntities(url)
			: null;
	if (!src) return "";

	const parts = [`src="${escapeHtml(src)}"`];
	const alt = attribute(attributes, "ac:alt");
	const title = attribute(attributes, "ac:title");
	const width = attribute(attributes, "ac:width");
	const height = attribute(attributes, "ac:height");
	parts.push(`alt="${escapeHtml(alt ?? "")}"`);
	if (title) parts.push(`title="${escapeHtml(title)}"`);
	if (width) parts.push(`width="${escapeHtml(width)}"`);
	if (height) parts.push(`height="${escapeHtml(height)}"`);
	const align = attribute(attributes, "ac:align");
	const classes = ["wiki-image"];
	if (align) classes.push(`wiki-image-${escapeHtml(align)}`);
	parts.push(`class="${classes.join(" ")}"`);
	return `<img ${parts.join(" ")} />`;
}

function linkBody(inner: string, fallback: string) {
	const plain = inner.match(
		/<ac:plain-text-link-body>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/ac:plain-text-link-body>/,
	);
	if (plain) return decodeEntities(plain[1]).trim();
	const rich = inner.match(/<ac:link-body[^>]*>([\s\S]*?)<\/ac:link-body>/);
	if (rich) return rich[1];
	return fallback;
}

function renderLink(_attributes: string, inner: string, ctx: StorageContext) {
	const user = inner.match(
		/<ri:user\b[^>]*\bri:(?:userkey|username)="([^"]*)"/,
	);
	if (user) {
		const name = escapeHtml(linkBody(inner, decodeEntities(user[1])));
		return `<span class="user-mention">${name}</span>`;
	}

	const issue = inner.match(/<ri:issue\b[^>]*\bri:key="([^"]*)"/);
	if (issue) {
		const key = decodeEntities(issue[1]);
		return `<a class="issue-link" href="/browse/${escapeHtml(key)}">${escapeHtml(linkBody(inner, key))}</a>`;
	}

	const page = inner.match(/<ri:page\b[^>]*>/);
	const pageTitle = page ? attribute(page[0], "ri:content-title") : null;
	if (page && pageTitle !== null) {
		const title = pageTitle;
		const body = escapeHtml(linkBody(inner, title));
		const spaceKey = attribute(page[0], "ri:space-key");
		const sourceId =
			spaceKey && spaceKey.toLowerCase() !== ctx.spaceKey.toLowerCase()
				? ctx.otherSpacePages.get(otherSpacePageKey(spaceKey, title))
				: ctx.pageSourceIdByTitle.get(title);
		if (sourceId) {
			return `<a href="/pages/viewpage.action?pageId=${escapeHtml(sourceId)}">${body}</a>`;
		}
		return `<span class="wiki-missing-link">${body}</span>`;
	}

	const attachment = inner.match(
		/<ri:attachment\b[^>]*\bri:filename="([^"]*)"/,
	);
	if (attachment) {
		const fileName = decodeEntities(attachment[1]);
		const url = attachmentUrl(ctx, fileName);
		const body = escapeHtml(linkBody(inner, fileName));
		if (!url) return `<span class="wiki-missing-link">${body}</span>`;
		return `<a class="wiki-attachment-link" href="${escapeHtml(url)}">${body}</a>`;
	}

	const url = inner.match(/<ri:url\b[^>]*\bri:value="([^"]*)"/);
	if (url) {
		const href = decodeEntities(url[1]);
		return `<a href="${escapeHtml(href)}">${escapeHtml(linkBody(inner, href))}</a>`;
	}

	const space = inner.match(/<ri:space\b[^>]*\bri:space-key="([^"]*)"/);
	if (space) {
		const key = decodeEntities(space[1]);
		return `<a href="/display/${encodeURIComponent(key)}">${escapeHtml(linkBody(inner, key))}</a>`;
	}

	return linkBody(inner, "");
}

function renderTaskList(inner: string) {
	const tasks: string[] = [];
	for (const match of inner.matchAll(/<ac:task>([\s\S]*?)<\/ac:task>/g)) {
		const task = match[1];
		const complete = /<ac:task-status>\s*complete\s*<\/ac:task-status>/.test(
			task,
		);
		const body = task.match(/<ac:task-body>([\s\S]*?)<\/ac:task-body>/)?.[1];
		tasks.push(
			`<li class="wiki-task${complete ? " wiki-task-complete" : ""}"><span class="wiki-task-check" aria-hidden="true">${complete ? "\u2611" : "\u2610"}</span><span class="wiki-task-body">${body ?? ""}</span></li>`,
		);
	}
	return `<ul class="wiki-task-list">${tasks.join("")}</ul>`;
}

/**
 * Replaces the non-macro storage constructs (layout, task lists, images, links,
 * inline comment markers) with plain HTML. Macros must already be resolved.
 */
export function convertStorageElements(
	source: string,
	ctx: StorageContext,
): string {
	let html = source;

	html = html.replace(
		/<ac:inline-comment-marker\b([^>]*)>([\s\S]*?)<\/ac:inline-comment-marker>/g,
		(_match, attributes: string, inner: string) => {
			const reference = attribute(attributes, "ac:ref");
			if (!reference) return inner;
			const known = ctx.inlineMarkers.has(reference) ? "1" : "0";
			return `<span class="wiki-inline-marker" data-marker="${escapeHtml(reference)}" data-known="${known}">${inner}</span>`;
		},
	);

	html = html.replace(
		/<ac:layout\b[^>]*>([\s\S]*?)<\/ac:layout>/g,
		(_match, inner: string) =>
			`<div class="wiki-layout">${inner.replace(/<\/?ac:layout>/g, "")}</div>`,
	);

	html = html.replace(
		/<ac:layout-section\b([^>]*)>([\s\S]*?)<\/ac:layout-section>/g,
		(_match, attributes: string, inner: string) => {
			const type = attribute(attributes, "ac:type") ?? "single";
			const layout = layoutClasses[type] ?? "wiki-layout-single";
			const cells = [
				...inner.matchAll(/<ac:layout-cell>([\s\S]*?)<\/ac:layout-cell>/g),
			]
				.map((cell) => `<div class="wiki-layout-cell">${cell[1]}</div>`)
				.join("");
			return `<div class="wiki-layout-section ${layout}">${cells}</div>`;
		},
	);

	html = html.replace(
		/<ac:task-list\b[^>]*>([\s\S]*?)<\/ac:task-list>/g,
		(_match, inner: string) => renderTaskList(inner),
	);

	html = html.replace(
		/<ac:image\b([^>]*)>([\s\S]*?)<\/ac:image>|<ac:image\b([^>]*)\/>/g,
		(
			_match,
			open: string | undefined,
			inner: string | undefined,
			self: string | undefined,
		) => renderImage(open ?? self ?? "", inner ?? "", ctx),
	);

	html = html.replace(/<ac:link\b([^>]*)\/>/g, (_match, attributes: string) => {
		const anchor = attribute(attributes, "ac:anchor");
		if (!anchor) return "";
		return `<a class="wiki-anchor-link" href="#${escapeHtml(anchorId(anchor))}">${escapeHtml(anchor)}</a>`;
	});

	html = html.replace(
		/<ac:link\b([^>]*)>([\s\S]*?)<\/ac:link>/g,
		(_match, attributes: string, inner: string) =>
			renderLink(attributes, inner, ctx),
	);

	html = html.replace(
		/<ac:emoticon\b([^>]*)\/>/g,
		(_match, attributes: string) => {
			const name = attribute(attributes, "ac:name") ?? "";
			return `<span class="wiki-emoticon">${emoticons[name] ?? "\u{1f642}"}</span>`;
		},
	);

	html = html.replace(/<ac:placeholder\b[^>]*>[\s\S]*?<\/ac:placeholder>/g, "");
	html = html.replace(/<ac:placeholder\b[^>]*\/>/g, "");

	html = html.replace(/<ac:[^>]*>/g, "").replace(/<\/ac:[^>]*>/g, "");
	html = html.replace(/<ri:[^>]*\/>/g, "").replace(/<\/ri:[^>]*>/g, "");
	html = html.replace(/<ac:parameter\b[^>]*\/>/g, "");
	return html;
}

const lengthValue =
	/^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%|pt|cm|mm|in|vw|vh))$/;

/**
 * Layout hints (column widths, alignment, indentation) that imported storage
 * uses. The sanitiser drops every other declaration, so a stored body cannot
 * reposition or overlay the interface.
 */
const allowedStyles: sanitizeHtml.IOptions["allowedStyles"] = {
	"*": {
		width: [lengthValue],
		"min-width": [lengthValue],
		"max-width": [lengthValue],
		height: [lengthValue],
		"text-align": [/^(?:left|right|center|justify|start|end)$/],
		"vertical-align": [
			/^(?:baseline|sub|super|text-top|text-bottom|middle|top|bottom|[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%))$/,
		],
		"white-space": [/^(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/],
		"padding-left": [lengthValue],
		"margin-left": [lengthValue],
	},
};

const allowedTags = [
	"a",
	"abbr",
	"blockquote",
	"br",
	"button",
	"caption",
	"code",
	"col",
	"colgroup",
	"dd",
	"del",
	"details",
	"div",
	"dl",
	"dt",
	"em",
	"figcaption",
	"figure",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"iframe",
	"img",
	"input",
	"ins",
	"kbd",
	"label",
	"li",
	"mark",
	"ol",
	"p",
	"pre",
	"q",
	"s",
	"samp",
	"small",
	"span",
	"strong",
	"sub",
	"summary",
	"sup",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"time",
	"tr",
	"u",
	"ul",
	"var",
];

export const iframeHosts = [
	"www.youtube.com",
	"youtube.com",
	"youtube-nocookie.com",
	"www.youtube-nocookie.com",
	"player.vimeo.com",
	"docs.google.com",
	"drive.google.com",
	"www.google.com",
	"maps.google.com",
	"www.figma.com",
	"miro.com",
	"www.miro.com",
	"www.loom.com",
	"vimeo.com",
];

export function sanitizeWikiBody(html: string): string {
	return sanitizeHtml(html, {
		allowedTags,
		allowedAttributes: {
			a: ["href", "title", "class", "rel", "target", "id", "style"],
			button: [{ name: "type", values: ["submit"] }, "class"],
			form: ["action", "method", "class", "role", "aria-label"],
			img: ["src", "alt", "title", "width", "height", "class", "style"],
			iframe: [
				"src",
				"width",
				"height",
				"title",
				"frameborder",
				"allow",
				"allowfullscreen",
				"loading",
			],
			input: [
				{ name: "type", values: ["checkbox", "hidden", "search"] },
				"checked",
				"disabled",
				"name",
				"value",
				"placeholder",
				"aria-label",
			],
			p: ["style"],
			div: ["style"],
			span: ["style"],
			h1: ["style"],
			h2: ["style"],
			h3: ["style"],
			h4: ["style"],
			h5: ["style"],
			h6: ["style"],
			li: ["style"],
			ol: ["style"],
			ul: ["style"],
			table: ["style"],
			tbody: ["style"],
			tr: ["style"],
			td: ["colspan", "rowspan", "scope", "class", "style"],
			th: ["colspan", "rowspan", "scope", "class", "style"],
			col: ["span", "width", "class", "style"],
			colgroup: ["span", "width", "class", "style"],
			figure: ["style"],
			figcaption: ["style"],
			"*": [
				"class",
				"id",
				"data-marker",
				"data-known",
				"data-user-id",
				"data-user-key",
				"data-type",
				"data-checked",
				"data-min-level",
				"data-max-level",
				"data-macro",
				"data-space-key",
				"data-page-id",
			],
		},
		allowedStyles,
		allowedIframeHostnames: iframeHosts,
		allowIframeRelativeUrls: true,
		transformTags: {
			a: (tagName, attributes) => ({
				tagName,
				attribs: withSafeRel(attributes),
			}),
			// Page authors control the storage body: the only form that may reach a
			// reader is the search form the livesearch macro renders.
			form: (tagName, attributes) =>
				attributes.action === "/dosearchsite.action"
					? { tagName, attribs: { ...attributes, method: "get" } }
					: { tagName: "div", attribs: {} },
			iframe: (tagName, attributes) => {
				const src = attributes.src;
				if (!src) return { tagName: "span", attribs: {} };
				if (src.startsWith("/") || src.startsWith("#")) {
					return { tagName, attribs: attributes };
				}
				try {
					if (iframeHosts.includes(new URL(src).hostname)) {
						return { tagName, attribs: attributes };
					}
				} catch {
					// A source that is not a URL is shown as a plain link.
				}
				return {
					tagName: "a",
					attribs: {
						href: src,
						class: "wiki-widget-link",
						target: "_blank",
						rel: "noopener noreferrer",
					},
					text: src,
				};
			},
		},
		allowedSchemes: ["http", "https", "mailto"],
		allowedSchemesByTag: { img: ["http", "https"] },
		allowProtocolRelative: false,
	}).trim();
}
