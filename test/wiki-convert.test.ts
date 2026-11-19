import sanitizeHtml from "sanitize-html";
import { describe, expect, test } from "vitest";
import {
	wikiHtmlAllowedAttributes,
	wikiHtmlAllowedStyles,
	wikiHtmlAllowedTags,
} from "../src/lib/shared/wiki/doc-to-html.ts";
import {
	type ConvertReport,
	collectDocRefs,
	type DocMark,
	type DocNode,
	docToHtml,
	docToStorage,
	resolveDocRefs,
	storageToDoc,
	validateDoc,
	type WikiDoc,
} from "../src/lib/shared/wiki/index.ts";

const doc = (...content: DocNode[]): WikiDoc => ({ type: "doc", content });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const t = (text: string, ...marks: DocMark[]): DocNode =>
	marks.length ? { type: "text", text, marks } : { type: "text", text };
const mark = (type: string, attrs?: Record<string, unknown>) =>
	attrs ? { type, attrs } : { type };

const macroAttrs = (
	name: string,
	params: { name: string; value: string; ref?: unknown }[] = [],
	extra: Record<string, unknown> = {},
) => ({
	name,
	params,
	bodyType: null,
	body: null,
	macroId: null,
	schemaVersion: null,
	...extra,
});

const cases: [string, string, WikiDoc][] = [
	["empty storage", "", doc({ type: "paragraph" })],
	[
		"paragraph with entities and whitespace",
		"<p>a &amp; b &lt;c&gt;\n  &quot;d&quot;  e</p>",
		doc(p(t('a & b <c> "d" e'))),
	],
	[
		"text marks",
		"<p>a <strong>b</strong> <em>c</em><u>d</u><s>e</s><sub>f</sub><sup>g</sup><code>h</code></p>",
		doc(
			p(
				t("a "),
				t("b", mark("bold")),
				t(" "),
				t("c", mark("italic")),
				t("d", mark("underline")),
				t("e", mark("strike")),
				t("f", mark("subscript")),
				t("g", mark("superscript")),
				t("h", mark("code")),
			),
		),
	],
	[
		"nested marks are ordered canonically",
		"<p><em><strong>x</strong></em></p>",
		doc(p(t("x", mark("bold"), mark("italic")))),
	],
	[
		"colour and background span",
		'<p><span style="color: rgb(255, 0, 0); background-color: #fff;">x</span></p>',
		doc(
			p(
				t(
					"x",
					mark("textStyle", {
						backgroundColor: "#fff",
						color: "rgb(255, 0, 0)",
					}),
				),
			),
		),
	],
	[
		"headings and alignment",
		'<h2 style="text-align: center;">Title</h2><p style="text-align: right">r</p>',
		doc(
			{
				type: "heading",
				attrs: { level: 2, textAlign: "center" },
				content: [t("Title")],
			},
			{ type: "paragraph", attrs: { textAlign: "right" }, content: [t("r")] },
		),
	],
	[
		"empty line is an empty paragraph",
		"<p><br /></p><p>a<br />b</p>",
		doc({ type: "paragraph" }, p(t("a"), { type: "hardBreak" }, t("b"))),
	],
	[
		"external link",
		'<p><a href="https://example.com/x?a=1&amp;b=2">site</a></p>',
		doc(
			p(
				t(
					"site",
					mark("link", {
						anchor: null,
						href: "https://example.com/x?a=1&b=2",
						ref: null,
					}),
				),
			),
		),
	],
	[
		"link to a page with and without body",
		'<p><ac:link><ri:page ri:content-title="Home" ri:space-key="AB" /><ac:link-body>go <strong>home</strong></ac:link-body></ac:link> <ac:link><ri:page ri:content-title="Plain" /></ac:link></p>',
		doc(
			p(
				t("go ", {
					type: "link",
					attrs: {
						anchor: null,
						href: null,
						ref: {
							tag: "ri:page",
							attrs: { "ri:content-title": "Home", "ri:space-key": "AB" },
						},
					},
				}),
				t(
					"home",
					{
						type: "link",
						attrs: {
							anchor: null,
							href: null,
							ref: {
								tag: "ri:page",
								attrs: { "ri:content-title": "Home", "ri:space-key": "AB" },
							},
						},
					},
					mark("bold"),
				),
				t(" "),
				t("Plain", {
					type: "link",
					attrs: {
						anchor: null,
						href: null,
						ref: { tag: "ri:page", attrs: { "ri:content-title": "Plain" } },
					},
				}),
			),
		),
	],
	[
		"link to an attachment and an anchor",
		'<p><ac:link><ri:attachment ri:filename="a b.pdf" /></ac:link><ac:link ac:anchor="sec"><ac:plain-text-link-body><![CDATA[jump]]></ac:plain-text-link-body></ac:link></p>',
		doc(
			p(
				t("a b.pdf", {
					type: "link",
					attrs: {
						anchor: null,
						href: null,
						ref: { tag: "ri:attachment", attrs: { "ri:filename": "a b.pdf" } },
					},
				}),
				t("jump", {
					type: "link",
					attrs: { anchor: "sec", href: "#sec", ref: null },
				}),
			),
		),
	],
	[
		"user mention",
		'<p>hi <ac:link><ri:user ri:userkey="abc123" /></ac:link></p>',
		doc(
			p(t("hi "), {
				type: "mention",
				attrs: { userKey: "abc123" },
			}),
		),
	],
	[
		"nested and ordered lists",
		'<ul><li>a<ul><li>b</li></ul></li><li><p>c</p><p>d</p></li></ul><ol start="3"><li>x</li></ol>',
		doc(
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
					{ type: "listItem", content: [p(t("c")), p(t("d"))] },
				],
			},
			{
				type: "orderedList",
				attrs: { start: 3 },
				content: [{ type: "listItem", content: [p(t("x"))] }],
			},
		),
	],
	[
		"task list",
		"<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>done</ac:task-body></ac:task><ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>todo</ac:task-body></ac:task></ac:task-list>",
		doc({
			type: "taskList",
			content: [
				{
					type: "taskItem",
					attrs: { checked: true, taskId: "1" },
					content: [p(t("done"))],
				},
				{
					type: "taskItem",
					attrs: { checked: false, taskId: "2" },
					content: [p(t("todo"))],
				},
			],
		}),
	],
	[
		"table with header, spans and column widths",
		'<table><colgroup><col style="width: 100px;" /><col style="width: 200px;" /></colgroup><tbody><tr><th colspan="2" style="text-align: center">H</th></tr><tr><td rowspan="2" style="background-color: #eee">a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>',
		doc({
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
								textAlign: "center",
							},
							content: [p(t("H"))],
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
								colwidth: [100],
								background: "#eee",
							},
							content: [p(t("a"))],
						},
						{
							type: "tableCell",
							attrs: { colspan: 1, rowspan: 1, colwidth: [200] },
							content: [p(t("b"))],
						},
					],
				},
				{
					type: "tableRow",
					content: [
						{
							type: "tableCell",
							attrs: { colspan: 1, rowspan: 1, colwidth: [200] },
							content: [p(t("c"))],
						},
					],
				},
			],
		}),
	],
	[
		"images: attachment and url",
		'<p><ac:image ac:width="300" ac:align="center" ac:alt="pic"><ri:attachment ri:filename="x.png" /></ac:image><ac:image><ri:url ri:value="https://e.test/i.png" /></ac:image></p>',
		doc(
			p(
				{
					type: "image",
					attrs: {
						fileName: "x.png",
						width: "300",
						align: "center",
						alt: "pic",
					},
				},
				{ type: "image", attrs: { src: "https://e.test/i.png" } },
			),
		),
	],
	[
		"emoticon, rule, quote, date",
		'<p><ac:emoticon ac:name="tick" ac:emoji-id="2705" ac:emoji-fallback="✅" /> <time datetime="2025-01-02" /></p><hr /><blockquote><p>q</p></blockquote>',
		doc(
			p(
				{
					type: "emoticon",
					attrs: { name: "tick", emojiId: "2705", emojiFallback: "✅" },
				},
				t(" "),
				{ type: "date", attrs: { datetime: "2025-01-02" } },
			),
			{ type: "horizontalRule" },
			{ type: "blockquote", content: [p(t("q"))] },
		),
	],
	[
		"code block",
		"<pre>a\n  b</pre>",
		doc({ type: "codeBlock", content: [t("a\n  b")] }),
	],
	[
		"layout sections are kept",
		'<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><p>l</p></ac:layout-cell><ac:layout-cell><p>r</p></ac:layout-cell></ac:layout-section></ac:layout>',
		doc({
			type: "layoutSection",
			attrs: { type: "two_equal" },
			content: [
				{ type: "layoutCell", content: [p(t("l"))] },
				{ type: "layoutCell", content: [p(t("r"))] },
			],
		}),
	],
	[
		"rich body macro with parameters",
		'<ac:structured-macro ac:name="info" ac:schema-version="1" ac:macro-id="m-1"><ac:parameter ac:name="title">Hint</ac:parameter><ac:parameter ac:name="icon">false</ac:parameter><ac:rich-text-body><p>body</p></ac:rich-text-body></ac:structured-macro>',
		doc({
			type: "macro",
			attrs: macroAttrs(
				"info",
				[
					{ name: "title", value: "Hint" },
					{ name: "icon", value: "false" },
				],
				{ bodyType: "rich", macroId: "m-1", schemaVersion: "1" },
			),
			content: [p(t("body"))],
		}),
	],
	[
		"plain body macro keeps the text exactly",
		'<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[if (a < b && c) {\n  x();\n}]]></ac:plain-text-body></ac:structured-macro>',
		doc({
			type: "macro",
			attrs: macroAttrs("code", [{ name: "language", value: "js" }], {
				bodyType: "plain",
				body: "if (a < b && c) {\n  x();\n}",
			}),
			content: [],
		}),
	],
	[
		"macro without body and unknown macro with parameters",
		'<ac:structured-macro ac:name="toc" /><ac:structured-macro ac:name="vendor-thing"><ac:parameter ac:name="x">1</ac:parameter><ac:parameter ac:name="">default</ac:parameter></ac:structured-macro>',
		doc(
			{ type: "macro", attrs: macroAttrs("toc"), content: [] },
			{
				type: "macro",
				attrs: macroAttrs("vendor-thing", [
					{ name: "x", value: "1" },
					{ name: "", value: "default" },
				]),
				content: [],
			},
		),
	],
	[
		"macro parameter holding a resource reference",
		'<ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name"><ri:attachment ri:filename="f.pdf" /></ac:parameter></ac:structured-macro>',
		doc({
			type: "macro",
			attrs: macroAttrs("view-file", [
				{
					name: "name",
					value: "f.pdf",
					ref: { tag: "ri:attachment", attrs: { "ri:filename": "f.pdf" } },
				},
			]),
			content: [],
		}),
	],
	[
		"macro next to text stays inline",
		'<p>see <ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">top</ac:parameter></ac:structured-macro> here</p>',
		doc(
			p(
				t("see "),
				{
					type: "inlineMacro",
					attrs: macroAttrs("anchor", [{ name: "", value: "top" }]),
				},
				t(" here"),
			),
		),
	],
	[
		"a macro alone in a paragraph becomes a block macro",
		'<p><ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro></p>',
		doc({
			type: "macro",
			attrs: macroAttrs("toc", [{ name: "maxLevel", value: "3" }]),
			content: [],
		}),
	],
	[
		"legacy ac:macro element",
		'<ac:macro ac:name="tip"><ac:rich-text-body><p>t</p></ac:rich-text-body></ac:macro>',
		doc({
			type: "macro",
			attrs: macroAttrs("tip", [], { bodyType: "rich" }),
			content: [p(t("t"))],
		}),
	],
	[
		"inline comment marker",
		'<p><ac:inline-comment-marker ac:ref="r-1">noted</ac:inline-comment-marker></p>',
		doc(p(t("noted", mark("inlineComment", { ref: "r-1" })))),
	],
	[
		"div wrappers and loose text in table cells",
		'<div class="table-wrap"><table><tbody><tr><td>loose <strong>b</strong></td></tr></tbody></table></div>',
		doc({
			type: "table",
			content: [
				{
					type: "tableRow",
					content: [
						{
							type: "tableCell",
							attrs: { colspan: 1, rowspan: 1, colwidth: null },
							content: [p(t("loose "), t("b", mark("bold")))],
						},
					],
				},
			],
		}),
	],
];

describe("storageToDoc", () => {
	test.each(cases)("%s", (_name, storage, expected) => {
		expect(storageToDoc(storage)).toEqual(expected);
	});

	test("every produced document is valid", () => {
		for (const [, storage] of cases) {
			expect(validateDoc(storageToDoc(storage))).toBeNull();
		}
	});

	test("reports unknown elements and macros by name only", () => {
		const report: ConvertReport = { unknown: new Map() };
		const result = storageToDoc(
			'<p>x<blink>y</blink></p><ac:structured-macro ac:name="vendor-thing" /><ac:adf-extension>z</ac:adf-extension>',
			report,
		);
		expect([...report.unknown.keys()].sort()).toEqual([
			"ac:adf-extension",
			"blink",
			"macro:vendor-thing",
		]);
		expect(JSON.stringify(result)).toContain("y");
	});

	test("survives malformed input", () => {
		for (const broken of [
			"<p>unclosed",
			"</p></div>stray",
			"<ac:structured-macro",
			"<p a='1>x</p>",
			"<![CDATA[never closed",
			"<table><tr><td>x</table>",
		]) {
			expect(validateDoc(storageToDoc(broken))).toBeNull();
		}
	});
});

describe("round trip", () => {
	const canonical = cases.map(([name, storage]) => [name, storage] as const);

	test.each(canonical)("%s is a fixed point", (_name, storage) => {
		const first = storageToDoc(storage);
		const again = storageToDoc(docToStorage(first));
		expect(again).toEqual(first);
		expect(docToStorage(again)).toBe(docToStorage(first));
	});

	test("canonical storage is reproduced exactly", () => {
		for (const storage of [
			"<h1>T</h1><p>a <strong>b</strong> <em>c</em></p><p><br /></p>",
			'<ul><li>a<ul><li>b</li></ul></li></ul><ol start="2"><li>x</li></ol>',
			'<ac:structured-macro ac:name="info" ac:schema-version="1" ac:macro-id="m"><ac:parameter ac:name="title">T</ac:parameter><ac:rich-text-body><p>b</p></ac:rich-text-body></ac:structured-macro>',
			'<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[a]]]]><![CDATA[> b]]></ac:plain-text-body></ac:structured-macro>',
			'<p><ac:link><ri:page ri:content-title="P" ri:space-key="S" /></ac:link></p>',
			'<table><colgroup><col style="width: 50px;" /></colgroup><tbody><tr><th><p>h</p></th></tr></tbody></table>',
		]) {
			expect(docToStorage(storageToDoc(storage))).toBe(storage);
		}
	});

	test("a macro with an unknown name and parameters survives untouched", () => {
		const storage =
			'<ac:structured-macro ac:name="x-vendor" ac:schema-version="2" ac:macro-id="id"><ac:parameter ac:name="a">1</ac:parameter><ac:parameter ac:name="b"><ri:url ri:value="https://e.test" /></ac:parameter><ac:rich-text-body><p>in</p></ac:rich-text-body></ac:structured-macro>';
		expect(docToStorage(storageToDoc(storage))).toBe(storage);
	});
});

describe("docToHtml", () => {
	test("renders macros as elements for post-processing", () => {
		const html = docToHtml(
			storageToDoc(
				'<ac:structured-macro ac:name="info"><ac:parameter ac:name="title">A &quot;quoted&quot; &lt;b&gt;</ac:parameter><ac:rich-text-body><p>in</p></ac:rich-text-body></ac:structured-macro>',
			),
		);
		expect(html).toContain('data-macro="info"');
		expect(html).toContain(
			'data-params="{&quot;title&quot;:&quot;A \\&quot;quoted\\&quot; &lt;b&gt;&quot;}"',
		);
		expect(html).toContain('<div class="wiki-macro-body"><p>in</p></div>');
	});

	test("resolves page and attachment references through the context", () => {
		const source = storageToDoc(
			'<p><ac:link><ri:page ri:content-title="Home" ri:space-key="AB" /></ac:link><ac:image><ri:attachment ri:filename="x.png" /></ac:image></p>',
		);
		const refs = collectDocRefs(source);
		expect(refs.pages).toEqual([{ title: "Home", spaceKey: "AB" }]);
		expect(refs.attachments).toEqual([{ fileName: "x.png" }]);
		const ctx = {
			pageHref: () => "/pages/viewpage.action?pageId=1",
			attachmentHref: () => "/api/wiki/attachments/2",
		};
		const html = docToHtml(source, ctx);
		expect(html).toContain(
			'<a href="/pages/viewpage.action?pageId=1">Home</a>',
		);
		expect(html).toContain('<img src="/api/wiki/attachments/2" />');
		const resolved = resolveDocRefs(source, ctx);
		expect(JSON.stringify(resolved)).toContain("/api/wiki/attachments/2");
		expect(JSON.stringify(source)).not.toContain("/api/wiki/attachments/2");
	});

	test("an unresolved page link points at the create screen", () => {
		const html = docToHtml(
			storageToDoc(
				'<p><ac:link><ri:page ri:content-title="New one" /></ac:link></p>',
			),
		);
		expect(html).toContain("/pages/createpage.action?title=New+one");
		expect(html).toContain('data-sveltekit-preload-data="false"');
	});

	test("escapes text and refuses unsafe urls and styles", () => {
		const malicious = doc(
			p(
				t(
					"<script>alert(1)</script>",
					mark("link", { href: "javascript:alert(1)" }),
				),
				t("x", mark("textStyle", { color: "red; background: url(x)" })),
				t("y", mark("link", { href: 'https://e.test/" onmouseover="x' })),
			),
			{
				type: "macro",
				attrs: macroAttrs('a"><script>', [{ name: 'n"', value: "<v>" }]),
				content: [],
			},
		);
		const html = docToHtml(malicious);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("url(");
		expect(html).not.toContain('" onmouseover');
	});
});

describe("docToHtml allow-list", () => {
	test("sanitize-html with the wiki allow-list leaves the output unchanged", () => {
		for (const [name, storage] of cases) {
			const html = docToHtml(storageToDoc(storage), {
				pageHref: () => "/pages/viewpage.action?pageId=1",
				attachmentHref: () => "/api/wiki/attachments/2",
			});
			const clean = sanitizeHtml(html, {
				allowedTags: wikiHtmlAllowedTags,
				allowedAttributes: wikiHtmlAllowedAttributes,
				allowedStyles: wikiHtmlAllowedStyles,
				allowedSchemes: ["http", "https", "mailto", "tel"],
				allowedSchemesByTag: { img: ["http", "https"] },
			});
			expect(clean, name).toBe(html);
		}
	});
});
