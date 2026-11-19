import {
	type DocMark,
	type DocNode,
	type MacroParam,
	markOrder,
	type RiRef,
	type WikiDoc,
} from "./doc.ts";
import { escapeAttr, escapeText } from "./xml.ts";

const str = (value: unknown): string | null =>
	typeof value === "string" && value !== ""
		? value
		: typeof value === "number"
			? String(value)
			: null;

function attrsOf(node: DocNode | DocMark): Record<string, unknown> {
	return node.attrs ?? {};
}

function attrString(name: string, value: unknown): string {
	const text = str(value);
	return text === null ? "" : ` ${name}="${escapeAttr(text)}"`;
}

function cdata(text: string): string {
	return `<![CDATA[${text.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}

function riToXml(ref: RiRef): string {
	const attrs = Object.entries(ref.attrs)
		.map(([key, value]) => ` ${key}="${escapeAttr(String(value))}"`)
		.join("");
	if (!ref.children?.length) return `<${ref.tag}${attrs} />`;
	return `<${ref.tag}${attrs}>${ref.children.map(riToXml).join("")}</${ref.tag}>`;
}

function isRef(value: unknown): value is RiRef {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as RiRef).tag === "string" &&
		(value as RiRef).tag.startsWith("ri:")
	);
}

function styleAttr(declarations: [string, unknown][]): string {
	const parts = declarations
		.map(([key, value]) => [key, str(value)] as const)
		.filter((entry): entry is readonly [string, string] => entry[1] !== null)
		.map(([key, value]) => `${key}: ${value.replace(/[;"<>]/g, "")}`);
	return parts.length ? ` style="${escapeAttr(`${parts.join("; ")};`)}"` : "";
}

function markKey(mark: DocMark): string {
	return JSON.stringify([mark.type, mark.attrs ?? null]);
}

function sortedMarks(node: DocNode): DocMark[] {
	return [...(node.marks ?? [])].sort(
		(a, b) => markOrder.indexOf(a.type) - markOrder.indexOf(b.type),
	);
}

function plainText(nodes: DocNode[]): string {
	return nodes
		.map((node) =>
			node.type === "text" ? (node.text ?? "") : plainText(node.content ?? []),
		)
		.join("");
}

function wrapMark(mark: DocMark, inner: string, nodes: DocNode[]): string {
	const attrs = attrsOf(mark);
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
			const style = styleAttr([
				["color", attrs.color],
				["background-color", attrs.backgroundColor],
				["font-size", attrs.fontSize],
			]);
			return style ? `<span${style}>${inner}</span>` : inner;
		}
		case "inlineComment":
			return `<ac:inline-comment-marker${attrString("ac:ref", attrs.ref)}>${inner}</ac:inline-comment-marker>`;
		case "link": {
			if (isRef(attrs.ref)) {
				const ref = attrs.ref;
				const anchor = attrString("ac:anchor", attrs.anchor);
				const label = plainText(nodes);
				const defaultLabel =
					ref.attrs["ri:content-title"] ??
					ref.attrs["ri:filename"] ??
					ref.attrs["ri:space-key"] ??
					"";
				const body =
					label === defaultLabel && inner === escapeText(label)
						? ""
						: `<ac:link-body>${inner}</ac:link-body>`;
				return `<ac:link${anchor}>${riToXml(ref)}${body}</ac:link>`;
			}
			const href = str(attrs.href);
			const anchor = str(attrs.anchor);
			if (anchor !== null && (href === null || href === `#${anchor}`)) {
				return `<ac:link ac:anchor="${escapeAttr(anchor)}"><ac:link-body>${inner}</ac:link-body></ac:link>`;
			}
			if (href === null) return inner;
			return `<a href="${escapeAttr(href)}"${attrString("title", attrs.title)}>${inner}</a>`;
		}
		default:
			return inner;
	}
}

function inlineToStorage(nodes: DocNode[], depth = 0): string {
	let out = "";
	let index = 0;
	while (index < nodes.length) {
		const node = nodes[index] as DocNode;
		const marks = sortedMarks(node);
		const mark = marks[depth];
		if (!mark) {
			out += leafToStorage(node);
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
		const run = nodes.slice(index, end);
		out += wrapMark(
			mark,
			inlineToStorage(
				run.map((n) => ({ ...n, marks: sortedMarks(n) })),
				depth + 1,
			),
			run,
		);
		index = end;
	}
	return out;
}

function paramToXml(param: MacroParam): string {
	const inner = isRef(param.ref) ? riToXml(param.ref) : escapeText(param.value);
	return `<ac:parameter ac:name="${escapeAttr(param.name)}">${inner}</ac:parameter>`;
}

function macroToXml(node: DocNode, inline: boolean): string {
	const attrs = attrsOf(node);
	const params = (
		Array.isArray(attrs.params) ? attrs.params : []
	) as MacroParam[];
	const head = `<ac:structured-macro ac:name="${escapeAttr(String(attrs.name ?? ""))}"${attrString("ac:schema-version", attrs.schemaVersion)}${attrString("ac:macro-id", attrs.macroId)}`;
	let body = params.map(paramToXml).join("");
	if (attrs.bodyType === "plain") {
		body += `<ac:plain-text-body>${cdata(String(attrs.body ?? ""))}</ac:plain-text-body>`;
	} else if (attrs.bodyType === "rich") {
		const inner = inline
			? inlineToStorage(node.content ?? [])
			: blocksToStorage(node.content ?? []);
		body += `<ac:rich-text-body>${inner}</ac:rich-text-body>`;
	}
	return body === "" ? `${head} />` : `${head}>${body}</ac:structured-macro>`;
}

function leafToStorage(node: DocNode): string {
	const attrs = attrsOf(node);
	switch (node.type) {
		case "text":
			return escapeText(node.text ?? "");
		case "hardBreak":
			return "<br />";
		case "inlineMacro":
			return macroToXml(node, true);
		case "emoticon":
			return `<ac:emoticon${attrString("ac:name", attrs.name)}${attrString("ac:emoji-shortname", attrs.emojiShortname)}${attrString("ac:emoji-id", attrs.emojiId)}${attrString("ac:emoji-fallback", attrs.emojiFallback)} />`;
		case "mention": {
			const key = str(attrs.userKey) ?? str(attrs.userId) ?? "";
			const name = str(attrs.name);
			const body = name
				? `<ac:link-body>${escapeText(name)}</ac:link-body>`
				: "";
			return `<ac:link><ri:user ri:userkey="${escapeAttr(key)}" />${body}</ac:link>`;
		}
		case "date":
			return `<time${attrString("datetime", attrs.datetime)} />`;
		case "image":
			return imageToStorage(node);
		default:
			return "";
	}
}

function imageToStorage(node: DocNode): string {
	const attrs = attrsOf(node);
	const extra = (attrs.extra ?? {}) as Record<string, string>;
	const head = `<ac:image${attrString("ac:align", attrs.align)}${attrString("ac:alt", attrs.alt)}${attrString("ac:title", attrs.title)}${attrString("ac:width", attrs.width)}${attrString("ac:height", attrs.height)}${attrs.thumbnail === true ? ' ac:thumbnail="true"' : ""}${attrString("ac:border", attrs.border)}${Object.entries(
		extra,
	)
		.map(([key, value]) => ` ${key}="${escapeAttr(String(value))}"`)
		.join("")}`;
	let body = "";
	const fileName = str(attrs.fileName);
	if (fileName !== null) {
		const page = attrs.pageRef as
			| { title?: string; spaceKey?: string }
			| null
			| undefined;
		const pageXml = page?.title
			? `<ri:page ri:content-title="${escapeAttr(page.title)}"${attrString("ri:space-key", page.spaceKey)} />`
			: "";
		body = pageXml
			? `<ri:attachment ri:filename="${escapeAttr(fileName)}">${pageXml}</ri:attachment>`
			: `<ri:attachment ri:filename="${escapeAttr(fileName)}" />`;
	} else if (str(attrs.src) !== null) {
		body = `<ri:url ri:value="${escapeAttr(String(attrs.src))}" />`;
	}
	const caption = str(attrs.caption);
	if (caption) body += `<ac:caption><p>${escapeText(caption)}</p></ac:caption>`;
	return `${head}>${body}</ac:image>`;
}

function blockContent(nodes: DocNode[] | undefined): string {
	return blocksToStorage(nodes ?? []);
}

function isEmptyParagraph(node: DocNode | undefined) {
	return node?.type === "paragraph" && !node.content?.length;
}

function colgroupOf(table: DocNode): string {
	const first = table.content?.[0]?.content ?? [];
	const widths: number[] = [];
	for (const cell of first) {
		const colwidth = attrsOf(cell).colwidth;
		const span = Number(attrsOf(cell).colspan ?? 1) || 1;
		if (!Array.isArray(colwidth) || colwidth.length !== span) return "";
		for (const width of colwidth) {
			if (typeof width !== "number") return "";
			widths.push(width);
		}
	}
	if (widths.length === 0) return "";
	return `<colgroup>${widths.map((width) => `<col style="width: ${width}px;" />`).join("")}</colgroup>`;
}

function cellToStorage(cell: DocNode): string {
	const attrs = attrsOf(cell);
	const tag = cell.type === "tableHeader" ? "th" : "td";
	const colspan = Number(attrs.colspan ?? 1);
	const rowspan = Number(attrs.rowspan ?? 1);
	return `<${tag}${colspan > 1 ? ` colspan="${colspan}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}${styleAttr(
		[
			["background-color", attrs.background],
			["text-align", attrs.textAlign],
		],
	)}>${blockContent(cell.content)}</${tag}>`;
}

function itemBody(content: DocNode[]): string {
	const [first, ...rest] = content;
	if (isEmptyParagraph(first)) return blocksToStorage(rest);
	const plain =
		first?.type === "paragraph" &&
		!styleAttr([["text-align", first.attrs?.textAlign]]) &&
		rest.every((node) => node.type !== "paragraph");
	return plain
		? inlineToStorage(first.content ?? []) + blocksToStorage(rest)
		: blocksToStorage(content);
}

function listItemToStorage(item: DocNode): string {
	return `<li>${itemBody(item.content ?? [])}</li>`;
}

function blockToStorage(node: DocNode): string {
	const attrs = attrsOf(node);
	switch (node.type) {
		case "paragraph": {
			const inner = inlineToStorage(node.content ?? []);
			const style = styleAttr([["text-align", attrs.textAlign]]);
			return `<p${style}>${inner === "" ? "<br />" : inner}</p>`;
		}
		case "heading": {
			const level = Math.min(6, Math.max(1, Number(attrs.level) || 1));
			return `<h${level}${styleAttr([["text-align", attrs.textAlign]])}>${inlineToStorage(node.content ?? [])}</h${level}>`;
		}
		case "bulletList":
			return `<ul>${(node.content ?? []).map(listItemToStorage).join("")}</ul>`;
		case "orderedList":
			return `<ol${attrString("start", attrs.start)}${styleAttr([["list-style-type", attrs.listStyle]])}>${(node.content ?? []).map(listItemToStorage).join("")}</ol>`;
		case "taskList":
			return `<ac:task-list>${(node.content ?? []).map(taskToStorage).join("")}</ac:task-list>`;
		case "blockquote":
			return `<blockquote>${blockContent(node.content)}</blockquote>`;
		case "codeBlock":
			return `<pre>${escapeText(plainText(node.content ?? []))}</pre>`;
		case "horizontalRule":
			return "<hr />";
		case "table": {
			const rows = (node.content ?? [])
				.map(
					(row) =>
						`<tr>${(row.content ?? []).map(cellToStorage).join("")}</tr>`,
				)
				.join("");
			return `<table>${colgroupOf(node)}<tbody>${rows}</tbody></table>`;
		}
		case "layoutSection":
			return layoutSectionToStorage(node);
		case "macro":
			return macroToXml(node, false);
		default:
			return inlineToStorage([node]);
	}
}

function taskToStorage(item: DocNode): string {
	const attrs = attrsOf(item);
	const id = str(attrs.taskId);
	const uuid = str(attrs.taskUuid);
	const content = item.content ?? [];
	return `<ac:task>${id ? `<ac:task-id>${escapeText(id)}</ac:task-id>` : ""}${uuid ? `<ac:task-uuid>${escapeText(uuid)}</ac:task-uuid>` : ""}<ac:task-status>${attrs.checked === true ? "complete" : "incomplete"}</ac:task-status><ac:task-body>${itemBody(content)}</ac:task-body></ac:task>`;
}

function layoutSectionToStorage(node: DocNode): string {
	const cells = (node.content ?? [])
		.map(
			(cell) =>
				`<ac:layout-cell>${blockContent(cell.content)}</ac:layout-cell>`,
		)
		.join("");
	return `<ac:layout-section${attrString("ac:type", attrsOf(node).type)}>${cells}</ac:layout-section>`;
}

function blocksToStorage(nodes: DocNode[]): string {
	let out = "";
	let index = 0;
	while (index < nodes.length) {
		const node = nodes[index] as DocNode;
		if (node.type === "layoutSection") {
			let end = index;
			let sections = "";
			while (nodes[end]?.type === "layoutSection") {
				sections += layoutSectionToStorage(nodes[end] as DocNode);
				end++;
			}
			out += `<ac:layout>${sections}</ac:layout>`;
			index = end;
			continue;
		}
		out += blockToStorage(node);
		index++;
	}
	return out;
}

export function docToStorage(doc: WikiDoc): string {
	return blocksToStorage(doc.content ?? []);
}
