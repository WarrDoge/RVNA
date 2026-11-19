// The wiki document: ProseMirror/TipTap JSON. This file is the contract between the
// converters (storage <-> doc <-> html), the write API and the editor.

import {
	safeBorderStyle,
	safeBorderWidth,
	safeColour,
	safeCssValue,
	safeFontSize,
	safeListStyle,
	safeTextAlign,
} from "./style-values.ts";

export type DocMark = { type: string; attrs?: Record<string, unknown> };

export type DocNode = {
	type: string;
	attrs?: Record<string, unknown>;
	content?: DocNode[];
	marks?: DocMark[];
	text?: string;
};

export type WikiDoc = DocNode & { type: "doc"; content: DocNode[] };

/** A Confluence resource identifier (`ri:*` element), kept verbatim so nothing is lost. */
export type RiRef = {
	tag: string;
	attrs: Record<string, string>;
	children?: RiRef[];
};

export type MacroParam = { name: string; value: string; ref?: RiRef };

export type MacroAttrs = {
	name: string;
	params: MacroParam[];
	/** "rich": content is the body; "plain": `body` is the body; null: no body element. */
	bodyType: "rich" | "plain" | null;
	body: string | null;
	macroId: string | null;
	schemaVersion: string | null;
};

/**
 * Node types and their attrs.
 *
 * block:  paragraph{textAlign} heading{level,textAlign} bulletList orderedList{start,listStyle}
 *         listItem taskList taskItem{checked,taskId} blockquote codeBlock{language}
 *         horizontalRule table tableRow tableHeader|tableCell{colspan,rowspan,colwidth,background,textAlign}
 *         layoutSection{type} layoutCell macro{MacroAttrs; content = rich body blocks}
 * inline: text hardBreak image{src,fileName,pageRef,alt,title,width,height,align,thumbnail,border,caption,extra}
 *         emoticon{name,emojiId,emojiShortname,emojiFallback} mention{userKey,userId,name}
 *         date{datetime} inlineMacro{MacroAttrs; content = rich body inline nodes}
 * marks:  bold italic underline strike subscript superscript code
 *         textStyle{color,backgroundColor,fontSize}
 *         link{href,title,ref,anchor}   (`ref` is an RiRef for ac:link page/attachment/... targets)
 *         inlineComment{ref}
 *
 * Layouts are kept as `layoutSection` (attr `type`, e.g. "two_equal") holding `layoutCell`s,
 * which the editor shows as columns.
 */
export const blockNodeTypes = new Set([
	"paragraph",
	"heading",
	"bulletList",
	"orderedList",
	"listItem",
	"taskList",
	"taskItem",
	"blockquote",
	"codeBlock",
	"horizontalRule",
	"table",
	"tableRow",
	"tableHeader",
	"tableCell",
	"layoutSection",
	"layoutCell",
	"macro",
]);

export const inlineNodeTypes = new Set([
	"text",
	"hardBreak",
	"image",
	"emoticon",
	"mention",
	"date",
	"inlineMacro",
]);

export const markTypes = new Set([
	"bold",
	"italic",
	"underline",
	"strike",
	"subscript",
	"superscript",
	"code",
	"textStyle",
	"link",
	"inlineComment",
]);

/** Canonical outer-to-inner order of marks; storage and html output nest marks in this order. */
export const markOrder = [
	"link",
	"inlineComment",
	"textStyle",
	"bold",
	"italic",
	"underline",
	"strike",
	"subscript",
	"superscript",
	"code",
];

export const emptyDoc = (): WikiDoc => ({
	type: "doc",
	content: [{ type: "paragraph" }],
});

export function textOf(node: DocNode): string {
	if (node.type === "text") return node.text ?? "";
	if (node.type === "hardBreak") return "\n";
	return (node.content ?? []).map(textOf).join("");
}

const macroColours = new Set([
	"bgColor",
	"borderColor",
	"titleBGColor",
	"titleColor",
]);

function validateMarkStyle(mark: DocMark): string | null {
	if (mark.type !== "textStyle" || !mark.attrs) return null;
	const { color, backgroundColor, fontSize } = mark.attrs;
	if (color != null && safeColour(color) === null) return "invalid text colour";
	if (backgroundColor != null && safeCssValue(backgroundColor) === null) {
		return "invalid text background colour";
	}
	if (fontSize != null && safeFontSize(fontSize) === null) {
		return "invalid font size";
	}
	return null;
}

function validateNodeStyle(node: DocNode): string | null {
	const attrs = node.attrs;
	if (!attrs || typeof attrs !== "object") return null;
	if (node.type === "orderedList") {
		if (attrs.listStyle != null && safeListStyle(attrs.listStyle) === null) {
			return "invalid list style";
		}
	}
	if (
		node.type === "paragraph" ||
		node.type === "heading" ||
		node.type === "tableCell" ||
		node.type === "tableHeader"
	) {
		if (attrs.textAlign != null && safeTextAlign(attrs.textAlign) === null) {
			return "invalid text alignment";
		}
	}
	if (node.type === "tableCell" || node.type === "tableHeader") {
		if (attrs.background != null && safeCssValue(attrs.background) === null) {
			return "invalid cell background";
		}
	}
	if (node.type === "macro" || node.type === "inlineMacro") {
		if (!Array.isArray(attrs.params)) return null;
		for (const param of attrs.params as MacroParam[]) {
			if (typeof param?.name !== "string" || typeof param?.value !== "string") {
				continue;
			}
			if (macroColours.has(param.name)) {
				if (param.value !== "" && safeCssValue(param.value) === null) {
					return `invalid macro colour ${param.name}`;
				}
			} else if (
				param.name === "borderStyle" &&
				param.value !== "" &&
				safeBorderStyle(param.value) === null
			) {
				return "invalid macro border style";
			} else if (
				param.name === "borderWidth" &&
				param.value !== "" &&
				safeBorderWidth(param.value) === null
			) {
				return "invalid macro border width";
			}
		}
	}
	return null;
}

/** Returns an error message for a structurally invalid document, or null. */
export function validateDoc(doc: unknown): string | null {
	if (typeof doc !== "object" || doc === null)
		return "document is not an object";
	const root = doc as DocNode;
	if (root.type !== "doc" || !Array.isArray(root.content)) {
		return "document root must be a doc node with content";
	}
	let count = 0;
	const walk = (node: DocNode, depth: number): string | null => {
		if (typeof node !== "object" || node === null)
			return "node is not an object";
		if (++count > 500_000) return "document is too large";
		if (depth > 60) return "document is nested too deeply";
		const known =
			blockNodeTypes.has(node.type) || inlineNodeTypes.has(node.type);
		if (!known) return `unknown node type ${String(node.type)}`;
		if (node.type === "text") {
			if (typeof node.text !== "string") return "text node without text";
			for (const mark of node.marks ?? []) {
				if (!markTypes.has(mark.type))
					return `unknown mark ${String(mark.type)}`;
				const error = validateMarkStyle(mark);
				if (error) return error;
			}
		}
		const styleError = validateNodeStyle(node);
		if (styleError) return styleError;
		if (node.content !== undefined) {
			if (!Array.isArray(node.content)) return "content is not an array";
			for (const child of node.content) {
				const error = walk(child, depth + 1);
				if (error) return error;
			}
		}
		return null;
	};
	for (const child of root.content) {
		const error = walk(child, 1);
		if (error) return error;
	}
	return null;
}

/** Visits every node of a document, depth first. */
export function walkDoc(
	node: DocNode,
	visit: (node: DocNode, parent: DocNode | null) => void,
	parent: DocNode | null = null,
): void {
	visit(node, parent);
	for (const child of node.content ?? []) walkDoc(child, visit, node);
}
