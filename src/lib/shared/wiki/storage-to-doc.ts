import type { ConvertReport } from "./convert-types.ts";
import {
	type DocMark,
	type DocNode,
	type MacroParam,
	markOrder,
	type RiRef,
	type WikiDoc,
} from "./doc.ts";
import { knownMacros } from "./macro-names.ts";
import {
	isElement,
	parseXml,
	textContent,
	type XElement,
	type XNode,
} from "./xml.ts";

type Ctx = { report?: ConvertReport };

const blockTags = new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"blockquote",
	"pre",
	"hr",
	"table",
	"ac:task-list",
	"ac:layout",
	"ac:layout-section",
]);

const containerTags = new Set([
	"div",
	"dl",
	"dt",
	"dd",
	"figure",
	"figcaption",
	"section",
	"article",
	"header",
	"footer",
	"center",
	"li",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"td",
	"th",
	"caption",
	"ac:rich-text-body",
	"ac:layout-cell",
]);

const macroTags = new Set(["ac:structured-macro", "ac:macro"]);

const transparentInline = new Set([
	"span",
	"abbr",
	"small",
	"big",
	"kbd",
	"var",
	"samp",
	"q",
	"cite",
	"font",
	"ins",
	"mark",
	"dfn",
	"label",
	"nobr",
	"address",
]);

function note(ctx: Ctx, name: string) {
	if (!ctx.report) return;
	ctx.report.unknown.set(name, (ctx.report.unknown.get(name) ?? 0) + 1);
}

function parseStyle(style: string | undefined): Record<string, string> {
	const result: Record<string, string> = {};
	if (!style) return result;
	for (const declaration of style.split(";")) {
		const colon = declaration.indexOf(":");
		if (colon < 1) continue;
		result[declaration.slice(0, colon).trim().toLowerCase()] = declaration
			.slice(colon + 1)
			.trim();
	}
	return result;
}

function alignOf(style: Record<string, string>, attr?: string): string | null {
	const value = (style["text-align"] ?? attr ?? "").toLowerCase();
	return value === "center" || value === "right" || value === "justify"
		? value
		: null;
}

function withAttrs(
	type: string,
	attrs: Record<string, unknown>,
	content?: DocNode[],
): DocNode {
	const node: DocNode = { type };
	const kept = Object.fromEntries(
		Object.entries(attrs).filter(([, value]) => value !== null),
	);
	if (Object.keys(kept).length > 0) node.attrs = kept;
	if (content !== undefined) node.content = content;
	return node;
}

function collapse(text: string): string {
	return text.replace(/[ \t\r\n\f]+/g, " ");
}

function sameMarks(a: DocMark[] | undefined, b: DocMark[] | undefined) {
	return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function sortMarks(marks: DocMark[]): DocMark[] {
	return marks
		.map((mark) =>
			mark.attrs
				? {
						type: mark.type,
						attrs: Object.fromEntries(
							Object.entries(mark.attrs).sort(([a], [b]) => a.localeCompare(b)),
						),
					}
				: mark,
		)
		.sort((a, b) => markOrder.indexOf(a.type) - markOrder.indexOf(b.type));
}

function textNode(text: string, marks: DocMark[]): DocNode {
	const node: DocNode = { type: "text", text };
	if (marks.length > 0) node.marks = sortMarks(marks);
	return node;
}

/** Merges adjacent text, collapses whitespace across nodes and trims the line edges. */
function tidyInline(nodes: DocNode[]): DocNode[] {
	const merged: DocNode[] = [];
	for (const node of nodes) {
		const last = merged[merged.length - 1];
		if (
			node.type === "text" &&
			last?.type === "text" &&
			sameMarks(last.marks, node.marks)
		) {
			last.text = (last.text ?? "") + (node.text ?? "");
		} else {
			merged.push(node.type === "text" ? { ...node } : node);
		}
	}
	let atLineStart = true;
	const out: DocNode[] = [];
	for (const node of merged) {
		if (node.type === "text") {
			let text = collapse(node.text ?? "");
			if (atLineStart) text = text.replace(/^ /, "");
			else if (
				/ $/.test(out[out.length - 1]?.text ?? "") &&
				text.startsWith(" ")
			)
				text = text.slice(1);
			if (text === "") continue;
			out.push({ ...node, text });
			atLineStart = false;
		} else {
			out.push(node);
			atLineStart = node.type === "hardBreak";
		}
	}
	for (let i = out.length - 1; i >= 0; i--) {
		const node = out[i] as DocNode;
		if (node.type === "hardBreak") continue;
		if (node.type === "text") {
			const trimmed = (node.text ?? "").replace(/ +$/, "");
			if (trimmed === "") out.splice(i, 1);
			else out[i] = { ...node, text: trimmed };
			if (trimmed === "") continue;
		}
		break;
	}
	while (out[out.length - 1]?.type === "hardBreak") out.pop();
	for (let i = 0; i < out.length - 1; i++) {
		const node = out[i] as DocNode;
		if (node.type === "text" && out[i + 1]?.type === "hardBreak") {
			const trimmed = (node.text ?? "").replace(/ +$/, "");
			out[i] = { ...node, text: trimmed };
		}
	}
	return out.filter((node) => node.type !== "text" || node.text !== "");
}

function riRef(element: XElement): RiRef {
	const children = element.children.filter(
		(child): child is XElement =>
			isElement(child) && child.tag.startsWith("ri:"),
	);
	const ref: RiRef = { tag: element.tag, attrs: { ...element.attrs } };
	if (children.length > 0) ref.children = children.map(riRef);
	return ref;
}

function riPrimary(ref: RiRef): string {
	return (
		ref.attrs["ri:value"] ??
		ref.attrs["ri:filename"] ??
		ref.attrs["ri:content-title"] ??
		ref.attrs["ri:userkey"] ??
		ref.attrs["ri:username"] ??
		ref.attrs["ri:key"] ??
		ref.attrs["ri:space-key"] ??
		Object.values(ref.attrs)[0] ??
		""
	);
}

function riDefaultLabel(ref: RiRef): string {
	return riPrimary(ref);
}

function firstRi(element: XElement): XElement | undefined {
	return element.children.find(
		(child): child is XElement =>
			isElement(child) && child.tag.startsWith("ri:"),
	);
}

function styleMarks(style: Record<string, string>): DocMark[] {
	const marks: DocMark[] = [];
	const weight = style["font-weight"];
	if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) {
		marks.push({ type: "bold" });
	}
	if (style["font-style"] === "italic") marks.push({ type: "italic" });
	const decoration =
		style["text-decoration"] ?? style["text-decoration-line"] ?? "";
	if (decoration.includes("underline")) marks.push({ type: "underline" });
	if (decoration.includes("line-through")) marks.push({ type: "strike" });
	const color = style.color;
	const background = style["background-color"] ?? style.background;
	const fontSize = style["font-size"];
	if (color || background || fontSize) {
		const attrs: Record<string, unknown> = {};
		if (color) attrs.color = color;
		if (background) attrs.backgroundColor = background;
		if (fontSize) attrs.fontSize = fontSize;
		marks.push({ type: "textStyle", attrs });
	}
	return marks;
}

function addMark(marks: DocMark[], mark: DocMark): DocMark[] {
	if (mark.type === "inlineComment") return [...marks, mark];
	const index = marks.findIndex((m) => m.type === mark.type);
	if (index === -1) return [...marks, mark];
	const next = [...marks];
	if (mark.type === "textStyle") {
		next[index] = {
			type: "textStyle",
			attrs: { ...marks[index]?.attrs, ...mark.attrs },
		};
	} else if (mark.type === "link") {
		next[index] = mark;
	}
	return next;
}

function convertMacro(element: XElement, ctx: Ctx, inline: boolean): DocNode {
	const name = element.attrs["ac:name"] ?? "";
	if (!knownMacros.has(name)) note(ctx, `macro:${name}`);
	const params: MacroParam[] = [];
	let bodyType: "rich" | "plain" | null = null;
	let body: string | null = null;
	let bodyChildren: XNode[] = [];
	for (const child of element.children) {
		if (!isElement(child)) continue;
		if (child.tag === "ac:parameter" || child.tag === "ac:default-parameter") {
			const ri = firstRi(child);
			const param: MacroParam = {
				name:
					child.tag === "ac:parameter" ? (child.attrs["ac:name"] ?? "") : "",
				value: "",
			};
			if (ri) {
				param.ref = riRef(ri);
				param.value = riPrimary(param.ref);
			} else {
				param.value = textContent(child).trim();
			}
			params.push(param);
		} else if (child.tag === "ac:rich-text-body") {
			bodyType = "rich";
			bodyChildren = child.children;
		} else if (child.tag === "ac:plain-text-body") {
			bodyType = "plain";
			body = textContent(child);
		} else {
			note(ctx, `${element.tag}>${child.tag}`);
		}
	}
	const attrs = {
		name,
		params,
		bodyType,
		body,
		macroId: element.attrs["ac:macro-id"] ?? null,
		schemaVersion: element.attrs["ac:schema-version"] ?? null,
	};
	if (inline) {
		const content =
			bodyType === "rich" ? flattenToInline(blocksFrom(bodyChildren, ctx)) : [];
		return withAttrsKeepNull(
			"inlineMacro",
			attrs,
			content.length ? content : undefined,
		);
	}
	const content = bodyType === "rich" ? blocksFrom(bodyChildren, ctx) : [];
	return withAttrsKeepNull("macro", attrs, content);
}

function withAttrsKeepNull(
	type: string,
	attrs: Record<string, unknown>,
	content?: DocNode[],
): DocNode {
	const node: DocNode = { type, attrs };
	if (content !== undefined) node.content = content;
	return node;
}

function flattenToInline(blocks: DocNode[]): DocNode[] {
	const out: DocNode[] = [];
	for (const block of blocks) {
		if (out.length > 0) out.push({ type: "hardBreak" });
		if (block.type === "paragraph" || block.type === "heading") {
			out.push(...(block.content ?? []));
		} else {
			out.push(...flattenToInline(block.content ?? []));
		}
	}
	return out;
}

function convertImage(element: XElement, ctx: Ctx): DocNode | null {
	const attrs: Record<string, unknown> = {};
	const extra: Record<string, string> = {};
	const known: Record<string, string> = {
		"ac:width": "width",
		"ac:height": "height",
		"ac:align": "align",
		"ac:alt": "alt",
		"ac:title": "title",
		"ac:thumbnail": "thumbnail",
		"ac:border": "border",
	};
	for (const [key, value] of Object.entries(element.attrs)) {
		const target = known[key];
		if (target)
			attrs[target] = target === "thumbnail" ? value === "true" : value;
		else extra[key] = value;
	}
	if (Object.keys(extra).length > 0) attrs.extra = extra;
	for (const child of element.children) {
		if (!isElement(child)) continue;
		if (child.tag === "ri:attachment") {
			attrs.fileName = child.attrs["ri:filename"] ?? "";
			const page = firstRi(child);
			if (page) {
				attrs.pageRef = {
					title: page.attrs["ri:content-title"] ?? "",
					...(page.attrs["ri:space-key"]
						? { spaceKey: page.attrs["ri:space-key"] }
						: {}),
				};
			}
		} else if (child.tag === "ri:url") {
			attrs.src = child.attrs["ri:value"] ?? "";
		} else if (child.tag === "ac:caption") {
			attrs.caption = textContent(child).trim();
		} else {
			note(ctx, `ac:image>${child.tag}`);
		}
	}
	if (!attrs.fileName && !attrs.src) return null;
	return withAttrs("image", attrs);
}

function convertEmoticon(element: XElement): DocNode {
	return withAttrs("emoticon", {
		name: element.attrs["ac:name"] ?? "",
		emojiId: element.attrs["ac:emoji-id"] ?? null,
		emojiShortname: element.attrs["ac:emoji-shortname"] ?? null,
		emojiFallback: element.attrs["ac:emoji-fallback"] ?? null,
	});
}

function convertAcLink(
	element: XElement,
	marks: DocMark[],
	ctx: Ctx,
): DocNode[] {
	const ri = firstRi(element);
	const anchor = element.attrs["ac:anchor"] ?? null;
	let body: XElement | undefined;
	for (const child of element.children) {
		if (!isElement(child)) continue;
		if (
			child.tag === "ac:link-body" ||
			child.tag === "ac:plain-text-link-body"
		) {
			body = child;
		} else if (!child.tag.startsWith("ri:")) {
			note(ctx, `ac:link>${child.tag}`);
		}
	}
	const ref = ri ? riRef(ri) : null;

	if (ref?.tag === "ri:user") {
		const name = body ? textContent(body).trim() : "";
		return [
			withAttrs("mention", {
				userKey: ref.attrs["ri:userkey"] ?? ref.attrs["ri:username"] ?? null,
				userId: null,
				name: name === "" ? null : name,
			}),
		];
	}

	const linkAttrs: Record<string, unknown> = { href: null, ref: null, anchor };
	if (ref?.tag === "ri:url") {
		linkAttrs.href = ref.attrs["ri:value"] ?? null;
	} else if (ref) {
		linkAttrs.ref = ref;
	} else if (anchor) {
		linkAttrs.href = `#${anchor}`;
	}
	const hasTarget =
		linkAttrs.href !== null || linkAttrs.ref !== null || anchor !== null;
	const inner = hasTarget
		? addMark(marks, { type: "link", attrs: linkAttrs })
		: marks;
	let content: DocNode[];
	if (body?.tag === "ac:link-body") {
		content = inlineFrom(body.children, inner, ctx);
	} else if (body) {
		content = [textNode(textContent(body), inner)];
	} else {
		const label = ref ? riDefaultLabel(ref) : (anchor ?? "");
		content = label === "" ? [] : [textNode(label, inner)];
	}
	return content;
}

function inlineFrom(children: XNode[], marks: DocMark[], ctx: Ctx): DocNode[] {
	const out: DocNode[] = [];
	for (const child of children) {
		if (!isElement(child)) {
			out.push(
				textNode(child.cdata ? child.text : collapse(child.text), marks),
			);
			continue;
		}
		const tag = child.tag;
		switch (tag) {
			case "strong":
			case "b":
				out.push(
					...inlineFrom(child.children, addMark(marks, { type: "bold" }), ctx),
				);
				break;
			case "em":
			case "i":
				out.push(
					...inlineFrom(
						child.children,
						addMark(marks, { type: "italic" }),
						ctx,
					),
				);
				break;
			case "u":
			case "ins":
				out.push(
					...inlineFrom(
						child.children,
						addMark(marks, { type: "underline" }),
						ctx,
					),
				);
				break;
			case "s":
			case "strike":
			case "del":
				out.push(
					...inlineFrom(
						child.children,
						addMark(marks, { type: "strike" }),
						ctx,
					),
				);
				break;
			case "sub":
			case "sup":
				out.push(
					...inlineFrom(
						child.children,
						addMark(marks, {
							type: tag === "sub" ? "subscript" : "superscript",
						}),
						ctx,
					),
				);
				break;
			case "code":
				out.push(
					...inlineFrom(child.children, addMark(marks, { type: "code" }), ctx),
				);
				break;
			case "br":
				out.push({ type: "hardBreak" });
				break;
			case "a": {
				const href = child.attrs.href;
				if (!href) {
					out.push(...inlineFrom(child.children, marks, ctx));
					break;
				}
				const attrs: Record<string, unknown> = {
					href,
					ref: null,
					anchor: null,
				};
				if (child.attrs.title) attrs.title = child.attrs.title;
				out.push(
					...inlineFrom(
						child.children,
						addMark(marks, { type: "link", attrs }),
						ctx,
					),
				);
				break;
			}
			case "ac:link":
				out.push(...convertAcLink(child, marks, ctx));
				break;
			case "ac:image": {
				const image = convertImage(child, ctx);
				if (image)
					out.push(
						marks.length ? { ...image, marks: sortMarks(marks) } : image,
					);
				break;
			}
			case "img": {
				const src = child.attrs.src;
				if (src) {
					out.push(
						withAttrs("image", {
							src,
							alt: child.attrs.alt ?? null,
							width: child.attrs.width ?? null,
							height: child.attrs.height ?? null,
						}),
					);
				}
				break;
			}
			case "ac:emoticon":
				out.push(convertEmoticon(child));
				break;
			case "time":
				out.push(withAttrs("date", { datetime: child.attrs.datetime ?? "" }));
				break;
			case "ac:inline-comment-marker":
				out.push(
					...inlineFrom(
						child.children,
						[
							...marks,
							{
								type: "inlineComment",
								attrs: { ref: child.attrs["ac:ref"] ?? "" },
							},
						],
						ctx,
					),
				);
				break;
			case "ac:structured-macro":
			case "ac:macro":
				out.push(convertMacro(child, ctx, true));
				break;
			default:
				if (transparentInline.has(tag)) {
					const style = parseStyle(child.attrs.style);
					let next = marks;
					for (const mark of styleMarks(style)) next = addMark(next, mark);
					if (tag === "span" || tag === "font") {
						if (tag === "font" && child.attrs.color) {
							next = addMark(next, {
								type: "textStyle",
								attrs: { color: child.attrs.color },
							});
						}
					}
					out.push(...inlineFrom(child.children, next, ctx));
				} else if (blockTags.has(tag) || containerTags.has(tag)) {
					const blocks = blocksFrom([child], ctx);
					out.push(...flattenToInline(blocks));
				} else {
					note(ctx, tag);
					out.push(...inlineFrom(child.children, marks, ctx));
				}
		}
	}
	return out;
}

function paragraphOf(
	inline: DocNode[],
	attrs?: Record<string, unknown>,
): DocNode {
	const content = tidyInline(inline);
	const node: DocNode = { type: "paragraph" };
	if (attrs && Object.keys(attrs).length > 0) node.attrs = attrs;
	if (content.length > 0) node.content = content;
	return node;
}

type Kind = "block" | "inline" | "macro" | "space";

function classify(node: XNode): Kind {
	if (!isElement(node))
		return node.text.trim() === "" && !node.cdata ? "space" : "inline";
	if (macroTags.has(node.tag)) return "macro";
	if (blockTags.has(node.tag) || containerTags.has(node.tag)) return "block";
	return "inline";
}

function nonEmpty(blocks: DocNode[]): DocNode[] {
	return blocks.length > 0 ? blocks : [{ type: "paragraph" }];
}

function blocksFrom(children: XNode[], ctx: Ctx): DocNode[] {
	const out: DocNode[] = [];
	const kinds = children.map(classify);
	let index = 0;
	while (index < children.length) {
		const kind = kinds[index] as Kind;
		const child = children[index] as XNode;
		if (kind === "block") {
			out.push(...convertBlock(child as XElement, ctx));
			index++;
			continue;
		}
		let end = index;
		while (end < children.length && kinds[end] !== "block") end++;
		const run = children.slice(index, end);
		const runKinds = kinds.slice(index, end);
		const hasInline = runKinds.includes("inline");
		if (hasInline) {
			const content = inlineFrom(run, [], ctx);
			const hoisted = hoistSoleMacro(content);
			if (hoisted) out.push(hoisted);
			else {
				const paragraph = paragraphOf(content);
				if (paragraph.content) out.push(paragraph);
			}
		} else {
			for (let i = 0; i < run.length; i++) {
				if (runKinds[i] === "macro")
					out.push(convertMacro(run[i] as XElement, ctx, false));
			}
		}
		index = end;
	}
	return out;
}

function hoistSoleMacro(content: DocNode[]): DocNode | null {
	const tidy = tidyInline(content);
	const only = tidy[0];
	if (tidy.length === 1 && only?.type === "inlineMacro" && !only.content) {
		const name = only.attrs?.name;
		if (typeof name === "string" && !["anchor", "status"].includes(name)) {
			return { type: "macro", attrs: only.attrs, content: [] };
		}
	}
	return null;
}

function convertBlock(element: XElement, ctx: Ctx): DocNode[] {
	const tag = element.tag;
	const style = parseStyle(element.attrs.style);
	switch (tag) {
		case "p": {
			const content = inlineFrom(element.children, [], ctx);
			const hoisted = hoistSoleMacro(content);
			if (hoisted) return [hoisted];
			const align = alignOf(style, element.attrs.align);
			return [paragraphOf(content, align ? { textAlign: align } : undefined)];
		}
		case "h1":
		case "h2":
		case "h3":
		case "h4":
		case "h5":
		case "h6": {
			const align = alignOf(style, element.attrs.align);
			const node = withAttrs("heading", {
				level: Number(tag[1]),
				textAlign: align,
			});
			const content = tidyInline(inlineFrom(element.children, [], ctx));
			if (content.length > 0) node.content = content;
			return [node];
		}
		case "ul":
		case "ol":
			return [convertList(element, ctx)];
		case "blockquote":
			return [
				{
					type: "blockquote",
					content: nonEmpty(blocksFrom(element.children, ctx)),
				},
			];
		case "pre": {
			const language =
				/brush:\s*([\w+-]+)/.exec(element.attrs.class ?? "")?.[1] ?? null;
			const text = textContent(element);
			const node = withAttrs("codeBlock", { language });
			if (text !== "") node.content = [{ type: "text", text }];
			return [node];
		}
		case "hr":
			return [{ type: "horizontalRule" }];
		case "table":
			return [convertTable(element, ctx)];
		case "ac:task-list":
			return [convertTaskList(element, ctx)];
		case "ac:layout":
			return convertLayout(element, ctx);
		case "ac:layout-section":
			return [convertLayoutSection(element, ctx)];
		default:
			return blocksFrom(element.children, ctx);
	}
}

function convertListItem(element: XElement, ctx: Ctx): DocNode {
	const blocks = blocksFrom(element.children, ctx);
	if (blocks[0]?.type !== "paragraph") blocks.unshift({ type: "paragraph" });
	return { type: "listItem", content: blocks };
}

function convertList(element: XElement, ctx: Ctx): DocNode {
	const items: DocNode[] = [];
	for (const child of element.children) {
		if (!isElement(child)) continue;
		if (child.tag === "li") items.push(convertListItem(child, ctx));
		else if (child.tag === "ul" || child.tag === "ol") {
			const last = items[items.length - 1];
			const nested = convertList(child, ctx);
			if (last) last.content = [...(last.content ?? []), nested];
			else
				items.push({
					type: "listItem",
					content: [{ type: "paragraph" }, nested],
				});
		} else if (!macroTags.has(child.tag))
			note(ctx, `${element.tag}>${child.tag}`);
	}
	if (items.length === 0) {
		items.push({ type: "listItem", content: [{ type: "paragraph" }] });
	}
	if (element.tag === "ol") {
		const start = Number.parseInt(element.attrs.start ?? "", 10);
		const listStyle = parseStyle(element.attrs.style)["list-style-type"];
		return withAttrs(
			"orderedList",
			{
				start: Number.isFinite(start) && start !== 1 ? start : null,
				listStyle: listStyle && listStyle !== "decimal" ? listStyle : null,
			},
			items,
		);
	}
	return { type: "bulletList", content: items };
}

function convertTaskList(element: XElement, ctx: Ctx): DocNode {
	const items: DocNode[] = [];
	for (const child of element.children) {
		if (!isElement(child)) continue;
		if (child.tag !== "ac:task") {
			note(ctx, `ac:task-list>${child.tag}`);
			continue;
		}
		let taskId: string | null = null;
		let taskUuid: string | null = null;
		let checked = false;
		let body: XNode[] = [];
		for (const part of child.children) {
			if (!isElement(part)) continue;
			if (part.tag === "ac:task-id") taskId = textContent(part).trim();
			else if (part.tag === "ac:task-uuid") taskUuid = textContent(part).trim();
			else if (part.tag === "ac:task-status")
				checked = textContent(part).trim() === "complete";
			else if (part.tag === "ac:task-body") body = part.children;
			else note(ctx, `ac:task>${part.tag}`);
		}
		const blocks = blocksFrom(body, ctx);
		if (blocks[0]?.type !== "paragraph") blocks.unshift({ type: "paragraph" });
		items.push(withAttrs("taskItem", { checked, taskId, taskUuid }, blocks));
	}
	if (items.length === 0) {
		items.push({
			type: "taskItem",
			attrs: { checked: false },
			content: [{ type: "paragraph" }],
		});
	}
	return { type: "taskList", content: items };
}

function convertLayoutSection(element: XElement, ctx: Ctx): DocNode {
	const cells: DocNode[] = [];
	for (const child of element.children) {
		if (!isElement(child)) continue;
		if (child.tag === "ac:layout-cell") {
			cells.push({
				type: "layoutCell",
				content: nonEmpty(blocksFrom(child.children, ctx)),
			});
		} else {
			note(ctx, `ac:layout-section>${child.tag}`);
		}
	}
	if (cells.length === 0)
		cells.push({ type: "layoutCell", content: [{ type: "paragraph" }] });
	return withAttrs(
		"layoutSection",
		{ type: element.attrs["ac:type"] ?? null },
		cells,
	);
}

function convertLayout(element: XElement, ctx: Ctx): DocNode[] {
	const sections: DocNode[] = [];
	for (const child of element.children) {
		if (!isElement(child)) continue;
		if (child.tag === "ac:layout-section")
			sections.push(convertLayoutSection(child, ctx));
		else note(ctx, `ac:layout>${child.tag}`);
	}
	return sections;
}

function pixelWidth(element: XElement): number | null {
	const raw =
		parseStyle(element.attrs.style).width ?? element.attrs.width ?? "";
	const match = /^([\d.]+)(px)?$/.exec(raw.trim());
	return match ? Math.round(Number(match[1])) : null;
}

function convertTable(element: XElement, ctx: Ctx): DocNode {
	const widths: (number | null)[] = [];
	const rows: XElement[] = [];
	const collectRows = (parent: XElement) => {
		for (const child of parent.children) {
			if (!isElement(child)) continue;
			if (child.tag === "colgroup") {
				for (const col of child.children) {
					if (isElement(col) && col.tag === "col") widths.push(pixelWidth(col));
				}
			} else if (child.tag === "col") {
				widths.push(pixelWidth(child));
			} else if (child.tag === "tr") {
				rows.push(child);
			} else if (["thead", "tbody", "tfoot"].includes(child.tag)) {
				collectRows(child);
			} else if (child.tag !== "caption") {
				note(ctx, `table>${child.tag}`);
			}
		}
	};
	collectRows(element);

	const occupied: number[] = [];
	const tableRows: DocNode[] = [];
	for (const row of rows) {
		let column = 0;
		const cells: DocNode[] = [];
		for (const cell of row.children) {
			if (!isElement(cell)) continue;
			if (cell.tag !== "td" && cell.tag !== "th") {
				note(ctx, `tr>${cell.tag}`);
				continue;
			}
			while ((occupied[column] ?? 0) > 0) column++;
			const colspan = Math.max(
				1,
				Number.parseInt(cell.attrs.colspan ?? "1", 10) || 1,
			);
			const rowspan = Math.max(
				1,
				Number.parseInt(cell.attrs.rowspan ?? "1", 10) || 1,
			);
			const slice = widths.slice(column, column + colspan);
			const colwidth =
				slice.length === colspan && slice.every((w) => w !== null)
					? (slice as number[])
					: null;
			for (let k = 0; k < colspan; k++) occupied[column + k] = rowspan;
			column += colspan;
			const style = parseStyle(cell.attrs.style);
			const background =
				style["background-color"] ??
				style.background ??
				cell.attrs["data-highlight-colour"] ??
				null;
			cells.push({
				type: cell.tag === "th" ? "tableHeader" : "tableCell",
				attrs: {
					colspan,
					rowspan,
					colwidth,
					...(background ? { background } : {}),
					...(alignOf(style, cell.attrs.align)
						? { textAlign: alignOf(style, cell.attrs.align) }
						: {}),
				},
				content: nonEmpty(blocksFrom(cell.children, ctx)),
			});
		}
		for (let k = 0; k < occupied.length; k++) {
			if ((occupied[k] ?? 0) > 0) occupied[k] = (occupied[k] as number) - 1;
		}
		if (cells.length > 0) tableRows.push({ type: "tableRow", content: cells });
	}
	if (tableRows.length === 0) {
		tableRows.push({
			type: "tableRow",
			content: [
				{
					type: "tableCell",
					attrs: { colspan: 1, rowspan: 1, colwidth: null },
					content: [{ type: "paragraph" }],
				},
			],
		});
	}
	return { type: "table", content: tableRows };
}

export function storageToDoc(storage: string, report?: ConvertReport): WikiDoc {
	const ctx: Ctx = { report };
	const content = blocksFrom(parseXml(storage ?? ""), ctx);
	return { type: "doc", content: nonEmpty(content) };
}
