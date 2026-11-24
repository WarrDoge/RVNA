// The editor schema. Node and mark names and attrs follow src/lib/shared/wiki/doc.ts exactly.
// Nothing here touches the DOM at module load, so `getSchema(schemaExtensions())` works in node.
import {
	type Attribute,
	type Editor,
	Extension,
	type Extensions,
	Mark,
	mergeAttributes,
	Node,
} from "@tiptap/core";
import { Code } from "@tiptap/extension-code";
import { Document } from "@tiptap/extension-document";
import Image from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { OrderedList } from "@tiptap/extension-list";
import {
	Table,
	TableCell,
	TableHeader,
	TableRow,
} from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { formatWikiDate } from "#lib/dates.ts";
import {
	type DocNode,
	emoticonChar,
	safeCssValue,
	safeFontSize,
	safeListStyle,
	safeTextAlign,
	safeUrl,
	type WikiDoc,
} from "../../shared/wiki/index.ts";

export { formatWikiDate };

const kebab = (name: string) =>
	name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

/** An attr carried through HTML (clipboard, drag and drop) in a data attribute; `json` keeps its type. */
function dataAttr(
	name: string,
	options: { json?: boolean; default?: unknown } = {},
): Attribute {
	const dataName = `data-${kebab(name)}`;
	const fallback = options.default ?? null;
	return {
		default: fallback,
		parseHTML: (element) => {
			const raw = element.getAttribute(dataName);
			if (raw === null) return fallback;
			if (!options.json) return raw;
			try {
				return JSON.parse(raw);
			} catch {
				return fallback;
			}
		},
		renderHTML: (attrs) => {
			const value = attrs[name];
			if (value === null || value === undefined) return {};
			return {
				[dataName]: options.json ? JSON.stringify(value) : String(value),
			};
		},
	};
}

/** Pasted colours are only kept when they stay readable on the dark theme. */
export function luminance(css: string): number | null {
	const value = css.trim().toLowerCase();
	let rgb: number[] | null = null;
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
	if (hex) {
		const digits =
			hex[1].length === 3
				? [...hex[1]].map((digit) => digit + digit).join("")
				: hex[1];
		rgb = [0, 2, 4].map((index) =>
			Number.parseInt(digits.slice(index, index + 2), 16),
		);
	} else {
		const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value);
		if (fn) rgb = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
	}
	if (!rgb) return null;
	return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

export function pastedTextColour(css: string | undefined): string | null {
	if (!css) return null;
	const light = luminance(css);
	return light !== null && light < 0.18 ? null : css;
}

export function pastedBackground(css: string | undefined): string | null {
	if (!css) return null;
	const light = luminance(css);
	return light !== null && light > 0.75 ? null : css;
}

const Subscript = Mark.create({
	name: "subscript",
	excludes: "superscript",
	parseHTML() {
		return [
			{ tag: "sub" },
			{
				style: "vertical-align",
				getAttrs: (value) => (value === "sub" ? null : false),
			},
		];
	},
	renderHTML({ HTMLAttributes }) {
		return ["sub", HTMLAttributes, 0];
	},
});

const Superscript = Mark.create({
	name: "superscript",
	excludes: "subscript",
	parseHTML() {
		return [
			{ tag: "sup" },
			{
				style: "vertical-align",
				getAttrs: (value) => (value === "super" ? null : false),
			},
		];
	},
	renderHTML({ HTMLAttributes }) {
		return ["sup", HTMLAttributes, 0];
	},
});

export type TextStyleAttrs = {
	color: string | null;
	backgroundColor: string | null;
	fontSize: string | null;
};

const TextStyle = Mark.create({
	name: "textStyle",
	addAttributes() {
		return {
			color: dataAttr("color"),
			backgroundColor: dataAttr("backgroundColor"),
			fontSize: dataAttr("fontSize"),
		};
	},
	parseHTML() {
		return [
			{
				tag: "span",
				consuming: false,
				getAttrs: (element) => {
					const style = (element as HTMLElement).style;
					const color =
						(element as HTMLElement).getAttribute("data-color") ??
						pastedTextColour(style.color);
					const backgroundColor =
						(element as HTMLElement).getAttribute("data-background-color") ??
						pastedBackground(style.backgroundColor);
					const fontSize = (element as HTMLElement).getAttribute(
						"data-font-size",
					);
					if (!color && !backgroundColor && !fontSize) return false;
					return { color, backgroundColor, fontSize };
				},
			},
		];
	},
	renderHTML({ mark, HTMLAttributes }) {
		const color = safeCssValue(mark.attrs.color);
		const backgroundColor = safeCssValue(mark.attrs.backgroundColor);
		const fontSize = safeFontSize(mark.attrs.fontSize);
		const style = [
			color && `color: ${color}`,
			backgroundColor && `background-color: ${backgroundColor}`,
			fontSize && `font-size: ${fontSize}`,
		]
			.filter(Boolean)
			.join("; ");
		return ["span", mergeAttributes(HTMLAttributes, style ? { style } : {}), 0];
	},
});

/** Applies colour, highlight or size to the selection; a null value removes it, an empty style removes the mark. */
export function setTextStyle(editor: Editor, attrs: Partial<TextStyleAttrs>) {
	editor
		.chain()
		.focus()
		.setMark("textStyle", attrs)
		.command(({ tr, state }) => {
			const type = state.schema.marks.textStyle;
			for (const range of tr.selection.ranges) {
				tr.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
					for (const mark of node.marks) {
						if (mark.type !== type) continue;
						const { color, backgroundColor, fontSize } = mark.attrs;
						if (!color && !backgroundColor && !fontSize) {
							tr.removeMark(pos, pos + node.nodeSize, type);
						}
					}
				});
			}
			if (tr.selection.empty) {
				const stored = tr.storedMarks?.find((mark) => mark.type === type);
				if (
					stored &&
					!stored.attrs.color &&
					!stored.attrs.backgroundColor &&
					!stored.attrs.fontSize
				) {
					tr.removeStoredMark(type);
				}
			}
			return true;
		})
		.run();
}

const InlineComment = Mark.create({
	name: "inlineComment",
	inclusive: false,
	excludes: "",
	addAttributes() {
		return { ref: dataAttr("ref") };
	},
	parseHTML() {
		return [{ tag: "span[data-ref][data-inline-comment]" }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				"data-inline-comment": "",
				class: "wiki-inline-comment",
			}),
			0,
		];
	},
});

const WikiLink = Link.extend({
	addAttributes() {
		return {
			href: {
				default: null,
				parseHTML: (element) => element.getAttribute("href"),
			},
			title: { default: null },
			ref: dataAttr("ref", { json: true }),
			anchor: dataAttr("anchor"),
		};
	},
});

const WikiCode = Code.extend({ excludes: "" });

const WikiDocument = Document.extend({ content: "(block | layoutSection)+" });

const WikiOrderedList = OrderedList.extend({
	addAttributes() {
		return {
			start: {
				default: 1,
				parseHTML: (element) =>
					element.hasAttribute("start")
						? Number.parseInt(element.getAttribute("start") ?? "", 10) || 1
						: 1,
			},
			listStyle: {
				default: null,
				parseHTML: (element) =>
					element.getAttribute("data-list-style") ??
					(element.style.listStyleType || null),
				renderHTML: (attrs) => {
					const listStyle = safeListStyle(attrs.listStyle);
					return listStyle
						? {
								"data-list-style": listStyle,
								style: `list-style-type: ${listStyle}`,
							}
						: {};
				},
			},
		};
	},
});

const WikiTaskItem = TaskItem.extend({
	addAttributes() {
		return { ...this.parent?.(), taskId: dataAttr("taskId") };
	},
});

const cellAttributes = (): Record<string, Attribute> => ({
	colspan: { default: 1 },
	rowspan: { default: 1 },
	colwidth: {
		default: null,
		parseHTML: (element) => {
			const raw = element.getAttribute("colwidth");
			return raw
				? raw.split(",").map((width) => Number.parseInt(width, 10))
				: null;
		},
	},
	background: {
		default: null,
		parseHTML: (element) => element.getAttribute("data-background"),
		renderHTML: (attrs) => {
			const background = safeCssValue(attrs.background);
			return background
				? {
						"data-background": background,
						style: `background-color: ${background}`,
					}
				: {};
		},
	},
});

const WikiTableCell = TableCell.extend({ addAttributes: cellAttributes });
const WikiTableHeader = TableHeader.extend({ addAttributes: cellAttributes });

/** `textAlign` on every block that can carry it. */
const TextAlign = Extension.create({
	name: "textAlign",
	addGlobalAttributes() {
		return [
			{
				types: ["paragraph", "heading", "tableCell", "tableHeader"],
				attributes: {
					textAlign: {
						default: null,
						parseHTML: (element) => element.getAttribute("data-text-align"),
						renderHTML: (attrs) => {
							const textAlign = safeTextAlign(attrs.textAlign);
							return textAlign
								? {
										"data-text-align": textAlign,
										style: `text-align: ${textAlign}`,
									}
								: {};
						},
					},
				},
			},
		];
	},
});

const WikiImage = Image.extend({
	addAttributes() {
		return {
			src: { default: null },
			fileName: dataAttr("fileName"),
			pageRef: dataAttr("pageRef", { json: true }),
			alt: { default: null },
			title: { default: null },
			width: { default: null },
			height: { default: null },
			align: dataAttr("align"),
			thumbnail: dataAttr("thumbnail", { json: true }),
			border: dataAttr("border", { json: true }),
			caption: dataAttr("caption"),
			extra: dataAttr("extra", { json: true }),
		};
	},
});

const Emoticon = Node.create({
	name: "emoticon",
	group: "inline",
	inline: true,
	atom: true,
	addAttributes() {
		return {
			name: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-emoticon"),
				renderHTML: (attrs) => ({ "data-emoticon": attrs.name ?? "" }),
			},
			emojiId: dataAttr("emojiId"),
			emojiShortname: dataAttr("emojiShortname"),
			emojiFallback: dataAttr("emojiFallback"),
		};
	},
	parseHTML() {
		return [{ tag: "span[data-emoticon]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(HTMLAttributes, { class: "wiki-emoticon" }),
			emoticonChar(node.attrs),
		];
	},
	renderText({ node }) {
		return emoticonChar(node.attrs);
	},
});

const Mention = Node.create({
	name: "mention",
	group: "inline",
	inline: true,
	atom: true,
	addAttributes() {
		return {
			userKey: dataAttr("userKey"),
			userId: dataAttr("userId"),
			name: dataAttr("name"),
		};
	},
	parseHTML() {
		return [{ tag: "span[data-mention]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				"data-mention": "",
				class: "wiki-mention",
			}),
			`@${node.attrs.name ?? ""}`,
		];
	},
	renderText({ node }) {
		return `@${node.attrs.name ?? ""}`;
	},
});

const DateNode = Node.create({
	name: "date",
	group: "inline",
	inline: true,
	atom: true,
	addAttributes() {
		return { datetime: { default: null } };
	},
	parseHTML() {
		return [{ tag: "time[datetime]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"time",
			mergeAttributes(HTMLAttributes, { class: "wiki-date" }),
			formatWikiDate(node.attrs.datetime),
		];
	},
	renderText({ node }) {
		return formatWikiDate(node.attrs.datetime);
	},
});

const macroAttributes = (): Record<string, Attribute> => ({
	name: dataAttr("name", { default: "" }),
	params: dataAttr("params", { json: true, default: [] }),
	bodyType: dataAttr("bodyType"),
	body: dataAttr("body"),
	macroId: dataAttr("macroId"),
	schemaVersion: dataAttr("schemaVersion"),
});

export const Macro = Node.create({
	name: "macro",
	group: "block",
	content: "block*",
	defining: true,
	isolating: true,
	selectable: true,
	addAttributes: macroAttributes,
	parseHTML() {
		return [{ tag: "div[data-wiki-macro]" }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				"data-wiki-macro": "",
				class: "wiki-macro",
			}),
			0,
		];
	},
});

export const InlineMacro = Node.create({
	name: "inlineMacro",
	group: "inline",
	inline: true,
	content: "inline*",
	selectable: true,
	addAttributes: macroAttributes,
	parseHTML() {
		return [{ tag: "span[data-wiki-inline-macro]" }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				"data-wiki-inline-macro": "",
				class: "wiki-inline-macro",
			}),
			0,
		];
	},
});

const LayoutSection = Node.create({
	name: "layoutSection",
	content: "layoutCell+",
	isolating: true,
	defining: true,
	selectable: true,
	addAttributes() {
		return { type: dataAttr("type", { default: "two_equal" }) };
	},
	parseHTML() {
		return [{ tag: "div[data-layout-section]" }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				"data-layout-section": "",
				class: "wiki-layout",
			}),
			0,
		];
	},
});

const LayoutCell = Node.create({
	name: "layoutCell",
	content: "block+",
	isolating: true,
	defining: true,
	parseHTML() {
		return [{ tag: "div[data-layout-cell]" }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				"data-layout-cell": "",
				class: "wiki-layout-cell",
			}),
			0,
		];
	},
});

export type SchemaOverrides = { macro?: Node; inlineMacro?: Node };

export function schemaExtensions(overrides: SchemaOverrides = {}): Extensions {
	return [
		StarterKit.configure({
			document: false,
			link: false,
			code: false,
			orderedList: false,
		}),
		WikiDocument,
		WikiLink.configure({
			openOnClick: false,
			autolink: true,
			defaultProtocol: "https",
			isAllowedUri: (url) => !url || safeUrl(url) !== null,
		}),
		WikiCode,
		WikiOrderedList,
		Subscript,
		Superscript,
		TextStyle,
		InlineComment,
		TaskList,
		WikiTaskItem.configure({ nested: true }),
		Table.configure({ resizable: true }),
		TableRow,
		WikiTableHeader,
		WikiTableCell,
		TextAlign,
		WikiImage.configure({ inline: true, allowBase64: false }),
		Emoticon,
		Mention,
		DateNode,
		overrides.macro ?? Macro,
		overrides.inlineMacro ?? InlineMacro,
		LayoutSection,
		LayoutCell,
	];
}

const needsParagraph = new Set([
	"listItem",
	"taskItem",
	"blockquote",
	"tableCell",
	"tableHeader",
	"layoutCell",
]);

/**
 * Gives containers that must hold a block one empty paragraph, so a document with an empty
 * rich macro body or an empty cell can be typed into. Returns the input when nothing changes.
 */
export function prepareDoc(doc: WikiDoc): WikiDoc {
	const fix = (node: DocNode): DocNode => {
		let content = node.content;
		if (content) {
			const next = content.map(fix);
			if (next.some((child, index) => child !== content?.[index]))
				content = next;
		}
		const empty = !content || content.length === 0;
		const wantsBody =
			needsParagraph.has(node.type) ||
			(node.type === "macro" && node.attrs?.bodyType === "rich");
		if (empty && wantsBody) content = [{ type: "paragraph" }];
		return content === node.content ? node : { ...node, content };
	};
	const fixed = fix(doc);
	if (!fixed.content || fixed.content.length === 0) {
		return { ...doc, content: [{ type: "paragraph" }] };
	}
	return fixed as WikiDoc;
}
