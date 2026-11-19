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
const pageIdPattern = /^\/pages\/viewpage\.action$/;
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

function decoded(value: string): string {
	const withoutQuery = value.split("?")[0].split("#")[0];
	try {
		return decodeURIComponent(withoutQuery);
	} catch {
		return withoutQuery;
	}
}

function rewriteHref(pathname: string, ctx: WikiLinkContext): string | null {
	const issue = pathname.match(issueKeyPattern);
	if (issue) return `/browse/${issue[1]}`;

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
		const title = decoded(display[2]).replace(/\+/g, " ");
		const id = ctx.pageIdsBySpaceTitle.get(
			spaceTitleKey(decoded(display[1]), title),
		);
		if (id) return `/pages/viewpage.action?pageId=${id}`;
	}

	if (pageIdPattern.test(pathname)) return null;

	return null;
}

const sessionTokenPattern = /([?&])(?:searchToken|atl_token)=[^&]*&?/g;

function withoutSessionTokens(value: string): string {
	if (!value.includes("Token=") && !value.includes("atl_token=")) return value;
	return value
		.replace(sessionTokenPattern, (_match, separator: string) =>
			separator === "?" ? "?" : "",
		)
		.replace(/\?&/, "?")
		.replace(/[?&]$/, "");
}

function attributeUrl(value: string, baseUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(value, baseUrl);
	} catch {
		return null;
	}
	return url.pathname;
}

export function sanitizeWikiHtml(
	html: string | null | undefined,
	ctx: WikiLinkContext,
	baseUrl: string,
): string | null {
	if (!html) return null;

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
				const pathname = attributeUrl(href, baseUrl);
				if (pathname === null) return { tagName, attribs };
				const rewritten = rewriteHref(pathname, ctx);
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
				const pathname = attributeUrl(src, baseUrl);
				if (pathname === null) return { tagName, attribs };
				const rewritten = rewriteHref(pathname, ctx);
				if (!rewritten) return { tagName, attribs };
				return { tagName, attribs: { ...attribs, src: rewritten } };
			},
		},
	}).trim();

	return clean === "" ? null : clean;
}

function storageLinkBody(inner: string, fallback: string): string {
	const plain = inner.match(
		/<ac:plain-text-link-body>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/ac:plain-text-link-body>/,
	);
	if (plain) return plain[1].trim();
	const rich = inner.match(/<ac:link-body[^>]*>([\s\S]*?)<\/ac:link-body>/);
	if (rich) return rich[1].trim();
	return fallback;
}

function rewriteStorageLink(
	inner: string,
	fallback: string,
	ctx: WikiLinkContext,
	pageSourceId: string,
) {
	const user = inner.match(
		/<ri:user\b[^>]*\bri:(?:userkey|username)="([^"]+)"/,
	);
	if (user) {
		const userId =
			ctx.userIdsByUserKey.get(user[1]) ?? ctx.userIdsByUsername.get(user[1]);
		const name =
			ctx.userNamesByUserKey.get(user[1]) ??
			storageLinkBody(inner, user[1]).replace(/&amp;/g, "&");
		const attribute = userId ? "data-user-id" : "data-user-key";
		return `<span class="user-mention" ${attribute}="${userId ?? user[1]}">${name}</span>`;
	}

	const issue = inner.match(/<ri:issue\b[^>]*\bri:key="([^"]+)"/);
	if (issue) {
		return `<a class="issue-link" href="/browse/${issue[1]}">${issue[1]}</a>`;
	}

	const pageTag = inner.match(/<ri:page\b[^>]*>/)?.[0] ?? "";
	const page = pageTag.match(/\bri:content-title="([^"]*)"/);
	if (page) {
		const title = page[1].replace(/&amp;/g, "&");
		const spaceKey = pageTag.match(/\bri:space-key="([^"]*)"/)?.[1];
		const id = spaceKey
			? ctx.pageIdsBySpaceTitle.get(spaceTitleKey(spaceKey, title))
			: undefined;
		const body = storageLinkBody(inner, title);
		if (id) return `<a href="/pages/viewpage.action?pageId=${id}">${body}</a>`;
		return `<span>${body}</span>`;
	}

	const attachment = inner.match(
		/<ri:attachment\b[^>]*\bri:filename="([^"]*)"/,
	);
	if (attachment) {
		const fileName = attachment[1].replace(/&amp;/g, "&");
		const id = ctx.attachmentIds.get(attachmentKey(pageSourceId, fileName));
		if (id) {
			return `<a href="/api/wiki/attachments/${id}">${storageLinkBody(inner, fileName)}</a>`;
		}
	}

	return storageLinkBody(inner, fallback);
}

function rewriteStorageImage(
	attribs: string,
	inner: string,
	ctx: WikiLinkContext,
	pageSourceId: string,
) {
	const attachment = inner.match(
		/<ri:attachment\b[^>]*\bri:filename="([^"]*)"/,
	);
	const alt = attribs.match(/\bac:alt="([^"]*)"/)?.[1];
	const width = attribs.match(/\bac:width="([^"]*)"/)?.[1];
	const height = attribs.match(/\bac:height="([^"]*)"/)?.[1];
	const parts = ["<img"];
	if (attachment) {
		const fileName = attachment[1].replace(/&amp;/g, "&");
		const id = ctx.attachmentIds.get(attachmentKey(pageSourceId, fileName));
		if (id) parts.push(`src="/api/wiki/attachments/${id}"`);
	}
	if (alt) parts.push(`alt="${alt}"`);
	if (width) parts.push(`width="${width}"`);
	if (height) parts.push(`height="${height}"`);
	if (parts.length === 1) return "";
	return `${parts.join(" ")} />`;
}

export function rewriteStorageReferences(
	storage: string | null | undefined,
	ctx: WikiLinkContext,
	pageSourceId: string,
): string {
	if (!storage) return "";

	return storage
		.replace(
			/<ac:structured-macro\b[^>]*\bac:name="jira"[^>]*>([\s\S]*?)<\/ac:structured-macro>|<ac:macro\b[^>]*\bac:name="jira"[^>]*>([\s\S]*?)<\/ac:macro>/g,
			(
				_match,
				structuredInner: string | undefined,
				oldInner: string | undefined,
			) => {
				const inner = structuredInner ?? oldInner ?? "";
				const key = inner
					.match(
						/<ac:parameter\b[^>]*\bac:name="key"[^>]*>([\s\S]*?)<\/ac:parameter>/,
					)?.[1]
					?.trim()
					.replace(/<!\[CDATA\[|\]\]>/g, "");
				if (!key) return "";
				return `<a class="issue-link" href="/browse/${key}">${key}</a>`;
			},
		)
		.replace(/<ac:link\b[^>]*>([\s\S]*?)<\/ac:link>/g, (match, inner: string) =>
			rewriteStorageLink(inner, match, ctx, pageSourceId),
		)
		.replace(
			/<ac:image\b([^>]*)>([\s\S]*?)<\/ac:image>/g,
			(_match, attribs: string, inner: string) =>
				rewriteStorageImage(attribs, inner, ctx, pageSourceId),
		);
}
