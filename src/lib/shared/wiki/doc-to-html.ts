import type { HtmlContext } from "./convert-types.ts";
import type { DocMark, DocNode, MacroParam, RiRef, WikiDoc } from "./doc.ts";
import { markOrder, safeUrl } from "./doc.ts";
import { emoticonChar } from "./emoticons.ts";
import { attachmentLookupOf, imageLookupOf, pageLookupOf } from "./refs.ts";
import { safeCssValue } from "./style-values.ts";
import { escapeAttr, escapeText } from "./xml.ts";

export const wikiHtmlAllowedTags = [
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

const dataAttributes = [
	"data-user-id",
	"data-user-key",
	"data-macro",
	"data-params",
	"data-emoticon",
	"data-ref",
	"data-file-name",
	"data-layout",
	"data-type",
	"data-checked",
];

export const wikiHtmlAllowedAttributes: Record<string, string[]> = {
	a: ["href", "title", "class", "rel", "name"],
	img: ["src", "alt", "title", "width", "height", "class"],
	td: ["colspan", "rowspan", "style", "class"],
	th: ["colspan", "rowspan", "style", "class"],
	col: ["style"],
	ol: ["start", "style", "class"],
	input: ["type", "checked", "disabled"],
	time: ["datetime"],
	"*": ["class", "style", ...dataAttributes],
};

export const wikiHtmlAllowedStyles = {
	"*": {
		color: [/^[#a-zA-Z0-9(),.%\s-]+$/],
		"background-color": [/^[#a-zA-Z0-9(),.%\s-]+$/],
		"font-size": [/^[\d.]+(px|pt|em|rem|%)$/],
		"text-align": [/^(left|right|center|justify)$/],
		width: [/^[\d.]+(px|%)$/],
		"list-style-type": [/^[a-z-]+$/],
	},
};

function css(property: string, value: unknown): string | null {
	const text =
		typeof value === "string" || typeof value === "number"
			? safeCssValue(String(value))
			: null;
	return text ? `${property}:${text}` : null;
}

function style(parts: (string | null)[]): string {
	const kept = parts.filter((part): part is string => part !== null);
	return kept.length ? ` style="${escapeAttr(kept.join(";"))}"` : "";
}

function attr(name: string, value: unknown): string {
	if (value === null || value === undefined || value === "") return "";
	return ` ${name}="${escapeAttr(String(value))}"`;
}

function macroClass(name: unknown): string {
	return String(name ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-");
}

function macroAttrs(node: DocNode): string {
	const attrs = node.attrs ?? {};
	const params = (
		Array.isArray(attrs.params) ? attrs.params : []
	) as MacroParam[];
	const data: Record<string, string> = {};
	for (const param of params) data[param.name] = param.value;
	return ` class="wiki-macro wiki-macro-${macroClass(attrs.name)}" data-macro="${escapeAttr(String(attrs.name ?? ""))}" data-params="${escapeAttr(JSON.stringify(data))}"`;
}

function plainText(nodes: DocNode[]): string {
	return nodes
		.map((node) =>
			node.type === "text" ? (node.text ?? "") : plainText(node.content ?? []),
		)
		.join("");
}

function linkHref(mark: DocMark, ctx: HtmlContext): string | null {
	const attrs = mark.attrs ?? {};
	const ref = attrs.ref as RiRef | null | undefined;
	if (ref && typeof ref === "object") {
		const page = pageLookupOf(ref, ctx.defaultSpaceKey);
		if (page) {
			const found = ctx.pageHref?.(page);
			if (found) return found;
			if (typeof attrs.href === "string" && attrs.href !== "")
				return attrs.href;
			const params = new URLSearchParams();
			if (page.spaceKey) params.set("spaceKey", page.spaceKey);
			params.set("title", page.title);
			return `/pages/createpage.action?${params}`;
		}
		const attachment = attachmentLookupOf(ref, ctx.defaultSpaceKey);
		if (attachment) {
			const found = ctx.attachmentHref?.(attachment);
			if (found) return found;
		}
	}
	const anchor =
		typeof attrs.anchor === "string" && attrs.anchor
			? `#${attrs.anchor}`
			: null;
	const href = safeUrl(attrs.href);
	return href ?? anchor;
}

function wrapMark(mark: DocMark, inner: string, ctx: HtmlContext): string {
	const attrs = mark.attrs ?? {};
	switch (mark.type) {
		case "bold":
			return `<strong>${inner}</strong>`;
		case "italic":
			return `<em>${inner}</em>`;
		case "underline":
			return `<u>${inner}</u>`;
		case "strike":
			return `<s>${inner}</s>`;
		case "subscript":
			return `<sub>${inner}</sub>`;
		case "superscript":
			return `<sup>${inner}</sup>`;
		case "code":
			return `<code>${inner}</code>`;
		case "textStyle": {
			const s = style([
				css("color", attrs.color),
				css("background-color", attrs.backgroundColor),
				css("font-size", attrs.fontSize),
			]);
			return s ? `<span${s}>${inner}</span>` : inner;
		}
		case "inlineComment":
			return `<span class="inline-comment-marker"${attr("data-ref", attrs.ref)}>${inner}</span>`;
		case "link": {
			const href = linkHref(mark, ctx);
			if (href === null) return inner;
			const unresolved = href.startsWith("/pages/createpage.action")
				? ' class="unresolved-link" data-sveltekit-preload-data="false"'
				: "";
			return `<a href="${escapeAttr(href)}"${attr("title", attrs.title)}${unresolved}>${inner}</a>`;
		}
		default:
			return inner;
	}
}

function markKey(mark: DocMark): string {
	return JSON.stringify([mark.type, mark.attrs ?? null]);
}

function sortedMarks(node: DocNode): DocMark[] {
	return [...(node.marks ?? [])].sort(
		(a, b) => markOrder.indexOf(a.type) - markOrder.indexOf(b.type),
	);
}

function inline(nodes: DocNode[], ctx: HtmlContext, depth = 0): string {
	let out = "";
	let index = 0;
	while (index < nodes.length) {
		const node = nodes[index] as DocNode;
		const mark = sortedMarks(node)[depth];
		if (!mark) {
			out += leaf(node, ctx);
			index++;
			continue;
		}
		const key = markKey(mark);
		let end = index + 1;
		while (end < nodes.length) {
			const next = sortedMarks(nodes[end] as DocNode)[depth];
			if (!next || markKey(next) !== key) break;
			end++;
		}
		const run = nodes
			.slice(index, end)
			.map((n) => ({ ...n, marks: sortedMarks(n) }));
		out += wrapMark(mark, inline(run, ctx, depth + 1), ctx);
		index = end;
	}
	return out;
}

function imageHtml(node: DocNode, ctx: HtmlContext): string {
	const attrs = node.attrs ?? {};
	const lookup = imageLookupOf(node, ctx.defaultSpaceKey);
	const resolved = lookup ? ctx.attachmentHref?.(lookup) : null;
	const src = safeUrl(resolved ?? attrs.src);
	const fileName = typeof attrs.fileName === "string" ? attrs.fileName : "";
	if (!src) {
		return `<span class="wiki-image-missing"${attr("data-file-name", fileName)}>${escapeText(fileName)}</span>`;
	}
	const align = ["left", "right", "center"].includes(String(attrs.align))
		? ` class="wiki-image-${attrs.align}"`
		: "";
	const size = (value: unknown) =>
		/^\d+(\.\d+)?$/.test(String(value ?? "")) ? value : null;
	return `<img src="${escapeAttr(src)}"${attr("alt", attrs.alt)}${attr("title", attrs.title)}${attr("width", size(attrs.width))}${attr("height", size(attrs.height))}${align} />`;
}

function leaf(node: DocNode, ctx: HtmlContext): string {
	const attrs = node.attrs ?? {};
	switch (node.type) {
		case "text":
			return escapeText(node.text ?? "");
		case "hardBreak":
			return "<br />";
		case "image":
			return imageHtml(node, ctx);
		case "emoticon":
			return `<span class="emoticon"${attr("data-emoticon", attrs.name)}>${escapeText(emoticonChar(attrs))}</span>`;
		case "mention": {
			const name =
				typeof attrs.name === "string" && attrs.name ? attrs.name : "";
			const id =
				typeof attrs.userId === "string" && attrs.userId ? attrs.userId : null;
			const idAttr = id
				? attr("data-user-id", id)
				: attr("data-user-key", attrs.userKey);
			return `<span class="user-mention"${idAttr}>${escapeText(name || "@user")}</span>`;
		}
		case "date": {
			const value = typeof attrs.datetime === "string" ? attrs.datetime : "";
			return `<time${attr("datetime", value)}>${escapeText(value)}</time>`;
		}
		case "inlineMacro": {
			const content = node.content ?? [];
			const body =
				content.length > 0
					? inline(content, ctx)
					: typeof attrs.body === "string"
						? escapeText(attrs.body)
						: "";
			return `<span${macroAttrs(node)}>${body}</span>`;
		}
		default:
			return "";
	}
}

function isEmptyParagraph(node: DocNode | undefined) {
	return node?.type === "paragraph" && !node.content?.length;
}

function itemBody(content: DocNode[], ctx: HtmlContext): string {
	const [first, ...rest] = content;
	if (isEmptyParagraph(first)) return blocks(rest, ctx);
	const plain =
		first?.type === "paragraph" &&
		!first.attrs?.textAlign &&
		rest.every((node) => node.type !== "paragraph");
	return plain
		? inline(first.content ?? [], ctx) + blocks(rest, ctx)
		: blocks(content, ctx);
}

function cellHtml(cell: DocNode, ctx: HtmlContext): string {
	const attrs = cell.attrs ?? {};
	const tag = cell.type === "tableHeader" ? "th" : "td";
	const span = (name: string, value: unknown) =>
		Number(value) > 1 ? ` ${name}="${Number(value)}"` : "";
	return `<${tag}${span("colspan", attrs.colspan)}${span("rowspan", attrs.rowspan)}${style(
		[
			css("background-color", attrs.background),
			css("text-align", attrs.textAlign),
		],
	)}>${blocks(cell.content ?? [], ctx)}</${tag}>`;
}

function colgroup(table: DocNode): string {
	const widths: number[] = [];
	for (const cell of table.content?.[0]?.content ?? []) {
		const colwidth = cell.attrs?.colwidth;
		if (!Array.isArray(colwidth)) return "";
		for (const width of colwidth) {
			if (typeof width !== "number") return "";
			widths.push(width);
		}
	}
	return widths.length
		? `<colgroup>${widths.map((width) => `<col style="width:${width}px" />`).join("")}</colgroup>`
		: "";
}

function block(node: DocNode, ctx: HtmlContext): string {
	const attrs = node.attrs ?? {};
	const align = style([css("text-align", attrs.textAlign)]);
	switch (node.type) {
		case "paragraph":
			return `<p${align}>${inline(node.content ?? [], ctx)}</p>`;
		case "heading": {
			const level = Math.min(6, Math.max(1, Number(attrs.level) || 1));
			return `<h${level}${align}>${inline(node.content ?? [], ctx)}</h${level}>`;
		}
		case "bulletList":
			return `<ul>${(node.content ?? []).map((item) => `<li>${itemBody(item.content ?? [], ctx)}</li>`).join("")}</ul>`;
		case "orderedList": {
			const start = Number(attrs.start);
			return `<ol${start > 1 ? ` start="${start}"` : ""}${style([css("list-style-type", attrs.listStyle)])}>${(node.content ?? []).map((item) => `<li>${itemBody(item.content ?? [], ctx)}</li>`).join("")}</ol>`;
		}
		case "taskList":
			return `<ul data-type="taskList">${(node.content ?? [])
				.map((item) => {
					const checked = item.attrs?.checked === true;
					return `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? " checked" : ""} disabled /></label><div>${itemBody(item.content ?? [], ctx)}</div></li>`;
				})
				.join("")}</ul>`;
		case "blockquote":
			return `<blockquote>${blocks(node.content ?? [], ctx)}</blockquote>`;
		case "codeBlock": {
			const language = String(attrs.language ?? "");
			const cls = /^[\w+-]+$/.test(language)
				? ` class="language-${language}"`
				: "";
			return `<pre><code${cls}>${escapeText(plainText(node.content ?? []))}</code></pre>`;
		}
		case "horizontalRule":
			return "<hr />";
		case "table":
			return `<table>${colgroup(node)}<tbody>${(node.content ?? [])
				.map(
					(row) =>
						`<tr>${(row.content ?? []).map((cell) => cellHtml(cell, ctx)).join("")}</tr>`,
				)
				.join("")}</tbody></table>`;
		case "layoutSection":
			return `<div class="wiki-layout"${attr("data-layout", attrs.type)}>${(
				node.content ?? []
			)
				.map(
					(cell) =>
						`<div class="wiki-layout-cell">${blocks(cell.content ?? [], ctx)}</div>`,
				)
				.join("")}</div>`;
		case "macro": {
			const content = node.content ?? [];
			const body =
				attrs.bodyType === "plain"
					? `<pre class="wiki-macro-body">${escapeText(String(attrs.body ?? ""))}</pre>`
					: attrs.bodyType === "rich"
						? `<div class="wiki-macro-body">${blocks(content, ctx)}</div>`
						: "";
			return `<div${macroAttrs(node)}>${body}</div>`;
		}
		default:
			return inline([node], ctx);
	}
}

function blocks(nodes: DocNode[], ctx: HtmlContext): string {
	return nodes.map((node) => block(node, ctx)).join("");
}

export function docToHtml(doc: WikiDoc, ctx: HtmlContext = {}): string {
	return blocks(doc.content ?? [], ctx);
}
