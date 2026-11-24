import sanitizeHtml from "sanitize-html";

const allowedTags = [
	"a",
	"abbr",
	"blockquote",
	"br",
	"caption",
	"code",
	"col",
	"colgroup",
	"dd",
	"del",
	"div",
	"dl",
	"dt",
	"em",
	"figcaption",
	"figure",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"img",
	"ins",
	"kbd",
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
	"sup",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"u",
	"ul",
	"var",
];

const issueKeyPattern = /^\/browse\/([A-Z][A-Z0-9_]*-\d+)$/;
const attachmentPattern =
	/^\/download\/(?:attachments|thumbnails)\/(\d+)\/(.+)$/;
const pageDisplayPattern = /^\/display\/([^/]+)\/(.+)$/;
const spacePagePattern = /^\/spaces\/([^/]+)\/pages\/(\d+)(?:\/|$)/;
const macroPattern = /<ac:(?:structured-)?macro\b[^>]*\bac:name="([^"]+)"/g;

export interface WikiLinkContext {
	pageIdsBySpaceTitle: Map<string, string>;
	pageIds: Set<string>;
	attachmentIds: Map<string, string>;
	userIdsByUsername: Map<string, string>;
	userIdsByUserKey: Map<string, string>;
	userNamesByUserKey: Map<string, string>;
}

export function spaceTitleKey(spaceKey: string, title: string): string {
	return `${spaceKey}\u0000${title}`;
}

export function attachmentKey(pageSourceId: string, fileName: string): string {
	return `${pageSourceId}/${fileName}`;
}

export function collectMacroNames(
	storage: string | null | undefined,
): string[] {
	if (!storage) return [];
	return [...storage.matchAll(macroPattern)].map((match) => match[1]);
}

function decoded(value: string, plusAsSpace = false): string {
	const withoutQuery = value.split("?")[0].split("#")[0];
	const prepared = plusAsSpace
		? withoutQuery.replace(/\+/g, " ")
		: withoutQuery;
	try {
		return decodeURIComponent(prepared);
	} catch {
		return prepared;
	}
}

function rewriteHref(
	url: URL,
	ctx: WikiLinkContext,
	baseOrigin: string | null,
): string | null {
	const pathname = url.pathname;
	const issue = pathname.match(issueKeyPattern);
	if (issue) return `/browse/${issue[1]}`;

	if (baseOrigin === null || url.origin !== baseOrigin) return null;

	const attachment = pathname.match(attachmentPattern);
	if (attachment) {
		const id = ctx.attachmentIds.get(
			attachmentKey(attachment[1], decoded(attachment[2])),
		);
		if (id) return `/api/wiki/attachments/${id}`;
		return null;
	}

	const spacePage = pathname.match(spacePagePattern);
	if (spacePage && ctx.pageIds.has(spacePage[2])) {
		return `/pages/viewpage.action?pageId=${spacePage[2]}`;
	}

	const display = pathname.match(pageDisplayPattern);
	if (display) {
		const title = decoded(display[2], true);
		const id = ctx.pageIdsBySpaceTitle.get(
			spaceTitleKey(decoded(display[1]), title),
		);
		if (id) return `/pages/viewpage.action?pageId=${id}`;
	}

	return null;
}

const sessionTokenPattern = /([?&])(?:searchToken|atl_token)=[^&]*&?/g;

function withoutSessionTokens(value: string): string {
	if (!value.includes("Token=") && !value.includes("atl_token=")) return value;
	return value
		.replace(sessionTokenPattern, (_match, separator: string) => separator)
		.replace(/\?&/, "?")
		.replace(/[?&]$/, "");
}

function attributeUrl(value: string, baseUrl: string): URL | null {
	try {
		return new URL(value, baseUrl);
	} catch {
		return null;
	}
}

export function sanitizeWikiHtml(
	html: string | null | undefined,
	ctx: WikiLinkContext,
	baseUrl: string,
): string | null {
	if (!html) return null;

	let baseOrigin: string | null = null;
	try {
		baseOrigin = new URL(baseUrl).origin;
	} catch {
		baseOrigin = null;
	}

	const clean = sanitizeHtml(html, {
		allowedTags,
		allowedAttributes: {
			a: ["href", "title", "class", "rel", "name"],
			img: ["src", "alt", "title", "width", "height", "class"],
			span: ["class", "data-user-id", "data-user-key"],
			"*": ["class"],
		},
		allowedSchemes: ["http", "https", "mailto"],
		allowedSchemesByTag: { img: ["http", "https"] },
		allowProtocolRelative: false,
		transformTags: {
			a: (tagName, attribs) => {
				const username = attribs["data-username"];
				const isMention = (attribs.class ?? "")
					.split(/\s+/)
					.includes("user-mention");
				if (isMention && username) {
					const userId = ctx.userIdsByUsername.get(username);
					const mention: sanitizeHtml.Attributes = {
						class: "user-mention",
					};
					mention[userId ? "data-user-id" : "data-user-key"] =
						userId ?? username;
					return { tagName: "span", attribs: mention };
				}

				const href = attribs.href;
				if (!href) return { tagName, attribs };
				const url = attributeUrl(href, baseUrl);
				if (url === null) return { tagName, attribs };
				const rewritten = rewriteHref(url, ctx, baseOrigin);
				if (!rewritten) {
					// Session tokens are per-render nonces that would change body_html on every import.
					return {
						tagName,
						attribs: { ...attribs, href: withoutSessionTokens(href) },
					};
				}
				return { tagName, attribs: { ...attribs, href: rewritten } };
			},
			img: (tagName, attribs) => {
				const src = attribs.src;
				if (!src) return { tagName, attribs };
				const url = attributeUrl(src, baseUrl);
				if (url === null) return { tagName, attribs };
				const rewritten = rewriteHref(url, ctx, baseOrigin);
				if (!rewritten) return { tagName, attribs };
				return { tagName, attribs: { ...attribs, src: rewritten } };
			},
		},
	}).trim();

	return clean === "" ? null : clean;
}

function decodeEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
			const code = Number.parseInt(hex, 16);
			return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		})
		.replace(/&#(\d+);/g, (match, decimal: string) => {
			const code = Number.parseInt(decimal, 10);
			return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		})
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function plainLinkBody(inner: string): string | null {
	const open = "<ac:plain-text-link-body>";
	const start = inner.indexOf(open);
	if (start === -1) return null;
	const end = inner.indexOf("</ac:plain-text-link-body>", start + open.length);
	if (end === -1) return null;
	let body = inner.slice(start + open.length, end).trim();
	if (body.startsWith("<![CDATA[")) body = body.slice("<![CDATA[".length);
	if (body.endsWith("]]>")) body = body.slice(0, -"]]>".length);
	return body.trim();
}

interface StorageElement {
	start: number;
	end: number;
	attrs: string;
	inner: string;
}

/**
 * The next `<name attrs>inner</name>` at or after `from`. A regular expression
 * that restarts at every `<name` costs quadratic time on text full of unclosed
 * tags; here a tag with no closing tag ends the search, because no later tag
 * can have one either, and a tag that `accepts` refuses is skipped whole.
 */
function nextElement(
	text: string,
	name: string,
	from: number,
	accepts?: (attrs: string) => boolean,
): StorageElement | null {
	const open = `<${name}`;
	const close = `</${name}>`;
	for (let at = text.indexOf(open, from); at !== -1; ) {
		const nameEnd = at + open.length;
		if (/\w/.test(text[nameEnd] ?? "")) {
			at = text.indexOf(open, nameEnd);
			continue;
		}
		const tagEnd = text.indexOf(">", nameEnd);
		if (tagEnd === -1) return null;
		const attrs = text.slice(nameEnd, tagEnd);
		if (accepts && !accepts(attrs)) {
			at = text.indexOf(open, tagEnd + 1);
			continue;
		}
		const innerEnd = text.indexOf(close, tagEnd + 1);
		if (innerEnd === -1) return null;
		return {
			start: at,
			end: innerEnd + close.length,
			attrs,
			inner: text.slice(tagEnd + 1, innerEnd),
		};
	}
	return null;
}

/** Replaces every element of the given names, the leftmost first, in one pass. */
function replaceElements(
	text: string,
	names: string[],
	render: (element: StorageElement) => string,
	accepts?: (attrs: string) => boolean,
): string {
	let out = "";
	let last = 0;
	const found = new Map<string, StorageElement | null>();
	for (;;) {
		let next: StorageElement | null = null;
		for (const name of names) {
			let element = found.get(name);
			if (element === undefined || (element && element.start < last)) {
				element = nextElement(text, name, last, accepts);
				found.set(name, element);
			}
			if (element && (!next || element.start < next.start)) next = element;
		}
		if (!next) break;
		out += text.slice(last, next.start) + render(next);
		last = next.end;
	}
	return out + text.slice(last);
}

/** The first `<name ...>` tag that `pattern` (sticky, starting at the tag) matches. */
function matchTag(
	text: string,
	name: string,
	pattern: RegExp,
): RegExpExecArray | null {
	const open = `<${name}`;
	for (let at = text.indexOf(open); at !== -1; ) {
		pattern.lastIndex = at;
		const match = pattern.exec(text);
		if (match) return match;
		const tagEnd = text.indexOf(">", at);
		if (tagEnd === -1) return null;
		at = text.indexOf(open, tagEnd + 1);
	}
	return null;
}

const userTag = /<ri:user\b[^>]*\bri:(?:userkey|username)="([^"]+)"/y;
const issueTag = /<ri:issue\b[^>]*\bri:key="([^"]+)"/y;
const pageTagPattern = /<ri:page\b[^>]*>/y;
const attachmentTag = /<ri:attachment\b[^>]*\bri:filename="([^"]*)"/y;

function richLinkBody(inner: string): string | null {
	const rich = nextElement(inner, "ac:link-body", 0);
	return rich ? rich.inner.trim() : null;
}

function storageLinkBody(inner: string, fallback: string): string {
	return plainLinkBody(inner) ?? richLinkBody(inner) ?? fallback;
}

function linkBodyHtml(inner: string, fallback: string): string {
	const plain = plainLinkBody(inner);
	if (plain !== null) return escapeHtml(decodeEntities(plain));
	return richLinkBody(inner) ?? escapeHtml(fallback);
}

function rewriteStorageLink(
	inner: string,
	fallback: string,
	ctx: WikiLinkContext,
	pageSourceId: string,
) {
	const user = matchTag(inner, "ri:user", userTag);
	if (user) {
		const userId =
			ctx.userIdsByUserKey.get(user[1]) ?? ctx.userIdsByUsername.get(user[1]);
		const storedName = ctx.userNamesByUserKey.get(user[1]);
		const name =
			storedName !== undefined
				? escapeHtml(storedName)
				: linkBodyHtml(inner, decodeEntities(user[1]));
		const attribute = userId ? "data-user-id" : "data-user-key";
		return `<span class="user-mention" ${attribute}="${escapeHtml(userId ?? decodeEntities(user[1]))}">${name}</span>`;
	}

	const issue = matchTag(inner, "ri:issue", issueTag);
	if (issue) {
		const key = escapeHtml(decodeEntities(issue[1]));
		return `<a class="issue-link" href="/browse/${key}">${key}</a>`;
	}

	const pageTag = matchTag(inner, "ri:page", pageTagPattern)?.[0] ?? "";
	const page = pageTag.match(/\bri:content-title="([^"]*)"/);
	if (page) {
		const title = decodeEntities(page[1]);
		const spaceKey = pageTag.match(/\bri:space-key="([^"]*)"/)?.[1];
		const id = spaceKey
			? ctx.pageIdsBySpaceTitle.get(spaceTitleKey(spaceKey, title))
			: undefined;
		const body = linkBodyHtml(inner, title);
		if (id)
			return `<a href="/pages/viewpage.action?pageId=${escapeHtml(id)}">${body}</a>`;
		return `<span>${body}</span>`;
	}

	const attachment = matchTag(inner, "ri:attachment", attachmentTag);
	if (attachment) {
		const fileName = decodeEntities(attachment[1]);
		const id = ctx.attachmentIds.get(attachmentKey(pageSourceId, fileName));
		const body = linkBodyHtml(inner, fileName);
		if (id) {
			return `<a href="/api/wiki/attachments/${escapeHtml(id)}">${body}</a>`;
		}
		return `<span>${body}</span>`;
	}

	return storageLinkBody(inner, fallback);
}

function rewriteStorageImage(
	attribs: string,
	inner: string,
	ctx: WikiLinkContext,
	pageSourceId: string,
) {
	const attachment = matchTag(inner, "ri:attachment", attachmentTag);
	const alt = attribs.match(/\bac:alt="([^"]*)"/)?.[1];
	const width = attribs.match(/\bac:width="([^"]*)"/)?.[1];
	const height = attribs.match(/\bac:height="([^"]*)"/)?.[1];
	const parts = ["<img"];
	if (attachment) {
		const fileName = decodeEntities(attachment[1]);
		const id = ctx.attachmentIds.get(attachmentKey(pageSourceId, fileName));
		if (id) parts.push(`src="/api/wiki/attachments/${id}"`);
	}
	if (alt) parts.push(`alt="${alt}"`);
	if (width) parts.push(`width="${width}"`);
	if (height) parts.push(`height="${height}"`);
	if (parts.length === 1) return "";
	return `${parts.join(" ")} />`;
}

/**
 * Rewrites Confluence storage references into HTML. Rich link bodies stay as
 * markup, so the caller must pass the result through sanitizeWikiHtml.
 */
export function rewriteStorageReferences(
	storage: string | null | undefined,
	ctx: WikiLinkContext,
	pageSourceId: string,
): string {
	if (!storage) return "";

	const withIssues = replaceElements(
		storage,
		["ac:structured-macro", "ac:macro"],
		(macro) => {
			const key = nextElement(macro.inner, "ac:parameter", 0, (attrs) =>
				/\bac:name="key"/.test(attrs),
			)
				?.inner.trim()
				.replace(/<!\[CDATA\[|\]\]>/g, "");
			if (!key) return "";
			return `<a class="issue-link" href="/browse/${key}">${key}</a>`;
		},
		(attrs) => /\bac:name="jira"/.test(attrs),
	);
	const withLinks = replaceElements(withIssues, ["ac:link"], (link) =>
		rewriteStorageLink(
			link.inner,
			withIssues.slice(link.start, link.end),
			ctx,
			pageSourceId,
		),
	);
	return replaceElements(withLinks, ["ac:image"], (image) =>
		rewriteStorageImage(image.attrs, image.inner, ctx, pageSourceId),
	);
}
