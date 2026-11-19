import { getSchema } from "@tiptap/core";
import { Node as PmNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import {
	formatWikiDate,
	luminance,
	pastedBackground,
	pastedTextColour,
	prepareDoc,
	schemaExtensions,
} from "../src/lib/editor/wiki/extensions.ts";
import {
	blockNodeTypes,
	type DocMark,
	type DocNode,
	inlineNodeTypes,
	markTypes,
	validateDoc,
	type WikiDoc,
} from "../src/lib/shared/wiki/index.ts";

const schema = getSchema(schemaExtensions());

const p = (...content: DocNode[]): DocNode =>
	content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
const t = (text: string, ...marks: DocMark[]): DocNode => ({
	type: "text",
	text,
	...(marks.length > 0 ? { marks } : {}),
});

const params = [
	{ name: "title", value: "Heads up" },
	{ name: "", value: "unnamed" },
	{
		name: "page",
		value: "Some page",
		ref: { tag: "ri:page", attrs: { "ri:content-title": "Some page" } },
	},
];

const doc: WikiDoc = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 2, textAlign: "right" },
			content: [t("Title")],
		},
		{
			type: "paragraph",
			attrs: { textAlign: "center" },
			content: [
				t("bold", { type: "bold" }),
				t("italic", { type: "italic" }),
				t("under", { type: "underline" }),
				t("strike", { type: "strike" }),
				t("sub", { type: "subscript" }),
				t("sup", { type: "superscript" }),
				t(
					"everything",
					{
						type: "link",
						attrs: {
							href: "/pages/viewpage.action?pageId=1",
							title: "t",
							ref: { tag: "ri:page", attrs: { "ri:content-title": "P" } },
							anchor: "top",
						},
					},
					{ type: "inlineComment", attrs: { ref: "c-1" } },
					{
						type: "textStyle",
						attrs: {
							color: "#ff5630",
							backgroundColor: "#222222",
							fontSize: "18px",
						},
					},
					{ type: "bold" },
					{ type: "italic" },
					{ type: "code" },
				),
				{ type: "hardBreak" },
				{
					type: "image",
					attrs: {
						src: "/a.png",
						fileName: "a.png",
						pageRef: { tag: "ri:page", attrs: {} },
						alt: "alt",
						title: "ttl",
						width: "300",
						height: "200",
						align: "center",
						thumbnail: true,
						border: false,
						caption: "cap",
						extra: { "ac:custom": "1" },
					},
				},
				{
					type: "emoticon",
					attrs: {
						name: "smile",
						emojiId: "1f600",
						emojiShortname: ":smile:",
						emojiFallback: "😀",
					},
				},
				{ type: "mention", attrs: { userKey: "k", userId: "u", name: "Ann" } },
				{ type: "date", attrs: { datetime: "2026-11-11" } },
				{
					type: "inlineMacro",
					attrs: {
						name: "anchor",
						params: [{ name: "", value: "top" }],
						bodyType: null,
						body: null,
						macroId: "m-1",
						schemaVersion: "1",
					},
				},
			],
		},
		{
			type: "bulletList",
			content: [
				{
					type: "listItem",
					content: [
						p(t("a")),
						{
							type: "bulletList",
							content: [{ type: "listItem", content: [p(t("b"))] }],
						},
					],
				},
			],
		},
		{
			type: "orderedList",
			attrs: { start: 3, listStyle: "lower-alpha" },
			content: [{ type: "listItem", content: [p(t("c"))] }],
		},
		{
			type: "taskList",
			content: [
				{
					type: "taskItem",
					attrs: { checked: true, taskId: "7" },
					content: [p(t("todo"))],
				},
			],
		},
		{ type: "blockquote", content: [p(t("quote"))] },
		{
			type: "codeBlock",
			attrs: { language: "ts" },
			content: [t("const a = 1;")],
		},
		{ type: "horizontalRule" },
		{
			type: "table",
			content: [
				{
					type: "tableRow",
					content: [
						{
							type: "tableHeader",
							attrs: {
								colspan: 2,
								rowspan: 1,
								colwidth: [100, 200],
								background: "#09326c",
								textAlign: "center",
							},
							content: [p(t("h"))],
						},
					],
				},
				{
					type: "tableRow",
					content: [
						{
							type: "tableCell",
							attrs: {
								colspan: 1,
								rowspan: 2,
								colwidth: null,
								background: "#164b35",
								textAlign: "right",
							},
							content: [p(t("x"))],
						},
						{
							type: "tableCell",
							attrs: { colspan: 1, rowspan: 1 },
							content: [p()],
						},
					],
				},
			],
		},
		{
			type: "layoutSection",
			attrs: { type: "three_with_sidebars" },
			content: [
				{ type: "layoutCell", content: [p(t("l"))] },
				{ type: "layoutCell", content: [p(t("m"))] },
				{ type: "layoutCell", content: [p(t("r"))] },
			],
		},
		{
			type: "macro",
			attrs: {
				name: "info",
				params,
				bodyType: "rich",
				body: null,
				macroId: "m-2",
				schemaVersion: "1",
			},
			content: [
				p(t("inside")),
				{
					type: "bulletList",
					content: [{ type: "listItem", content: [p(t("li"))] }],
				},
			],
		},
		{
			type: "macro",
			attrs: {
				name: "code",
				params: [{ name: "language", value: "bash" }],
				bodyType: "plain",
				body: "echo 1\necho 2",
				macroId: "m-3",
				schemaVersion: "1",
			},
		},
		{
			type: "macro",
			attrs: {
				name: "some-unknown-macro",
				params: [{ name: "x", value: "y" }],
				bodyType: null,
				body: null,
				macroId: null,
				schemaVersion: null,
			},
		},
	],
};

function strip(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(strip);
	if (value === null || typeof value !== "object") return value;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== null && item !== undefined)
		.map(([key, item]) => [key, strip(item)] as const);
	const result = Object.fromEntries(entries) as Record<string, unknown>;
	if (Array.isArray(result.marks)) {
		result.marks = [...(result.marks as { type: string }[])].sort((a, b) =>
			a.type.localeCompare(b.type),
		);
	}
	if (result.attrs && Object.keys(result.attrs).length === 0)
		result.attrs = undefined;
	return Object.fromEntries(
		Object.entries(result).filter(([, item]) => item !== undefined),
	);
}

describe("wiki editor schema", () => {
	it("has exactly the node and mark types of the document contract", () => {
		expect(new Set(Object.keys(schema.nodes))).toEqual(
			new Set(["doc", ...blockNodeTypes, ...inlineNodeTypes]),
		);
		expect(new Set(Object.keys(schema.marks))).toEqual(markTypes);
	});

	it("accepts a document that uses every node and mark", () => {
		expect(validateDoc(doc)).toBeNull();
		expect(() => PmNode.fromJSON(schema, doc).check()).not.toThrow();
	});

	it("keeps every attr through a load and getJSON round trip", () => {
		const roundTrip = PmNode.fromJSON(schema, doc).toJSON();
		expect(strip(roundTrip)).toEqual(strip(doc));
	});

	it("keeps unknown macros and unknown parameters untouched", () => {
		const roundTrip = PmNode.fromJSON(schema, doc).toJSON() as WikiDoc;
		const macros = roundTrip.content.filter((node) => node.type === "macro");
		expect(macros.map((node) => node.attrs?.name)).toEqual([
			"info",
			"code",
			"some-unknown-macro",
		]);
		expect(macros[0].attrs?.params).toEqual(params);
		expect(macros[2].attrs).toMatchObject({
			params: [{ name: "x", value: "y" }],
			macroId: null,
		});
	});

	it("rejects a macro with inline content in a block position", () => {
		const bad = {
			type: "doc",
			content: [{ type: "macro", content: [t("loose")] }],
		};
		expect(() => PmNode.fromJSON(schema, bad).check()).toThrow();
	});
});

describe("prepareDoc", () => {
	it("gives empty rich macro bodies and empty cells a paragraph", () => {
		const input: WikiDoc = {
			type: "doc",
			content: [
				{ type: "macro", attrs: { name: "info", bodyType: "rich" } },
				{ type: "macro", attrs: { name: "toc", bodyType: null } },
				{
					type: "table",
					content: [
						{ type: "tableRow", content: [{ type: "tableCell", content: [] }] },
					],
				},
			],
		};
		const fixed = prepareDoc(input);
		expect(fixed.content[0].content).toEqual([{ type: "paragraph" }]);
		expect(fixed.content[1].content).toBeUndefined();
		expect(fixed.content[2].content?.[0].content?.[0].content).toEqual([
			{ type: "paragraph" },
		]);
		expect(() => PmNode.fromJSON(schema, fixed).check()).not.toThrow();
	});

	it("returns the same object when nothing needs fixing and fills an empty document", () => {
		expect(prepareDoc(doc)).toBe(doc);
		expect(prepareDoc({ type: "doc", content: [] }).content).toEqual([
			{ type: "paragraph" },
		]);
	});
});

describe("helpers", () => {
	it("formats dates", () => {
		expect(formatWikiDate("2026-11-11")).toBe("Nov 11, 2026");
		expect(formatWikiDate("not a date")).toBe("not a date");
		expect(formatWikiDate(null)).toBe("");
	});

	it("drops pasted colours that cannot be read on the dark theme", () => {
		expect(luminance("#000")).toBe(0);
		expect(pastedTextColour("#000000")).toBeNull();
		expect(pastedTextColour("rgb(20, 20, 20)")).toBeNull();
		expect(pastedTextColour("#ff5630")).toBe("#ff5630");
		expect(pastedTextColour("red")).toBe("red");
		expect(pastedBackground("#ffffff")).toBeNull();
		expect(pastedBackground("rgb(255,255,200)")).toBeNull();
		expect(pastedBackground("#164b35")).toBe("#164b35");
		expect(pastedBackground(undefined)).toBeNull();
	});
});
