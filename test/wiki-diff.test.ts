import { expect, test } from "vitest";
import {
	diffBlocks,
	diffHtml,
	diffWords,
	htmlToBlocks,
} from "../src/lib/server/wiki/diff";

test("splits rendered HTML into one block per paragraph-like element", () => {
	expect(
		htmlToBlocks("<h1>Title</h1><p>first line</p><ul><li>item</li></ul>"),
	).toEqual(["Title", "first line", "item"]);
});

test("decodes entities and collapses whitespace", () => {
	expect(htmlToBlocks("<p>a &amp; b&nbsp;&nbsp; c</p>")).toEqual(["a & b c"]);
});

test("ignores an empty body", () => {
	expect(htmlToBlocks(null)).toEqual([]);
	expect(htmlToBlocks("")).toEqual([]);
});

test("marks inserted and deleted blocks", () => {
	const ops = diffBlocks(["one", "two"], ["one", "three"]);
	expect(ops).toEqual([
		{ type: "equal", text: "one" },
		{ type: "delete", text: "two" },
		{ type: "insert", text: "three" },
	]);
});

test("keeps a large unchanged prefix equal", () => {
	const before = Array.from({ length: 500 }, (_, index) => `line ${index}`);
	const after = [...before, "appended"];
	const ops = diffBlocks(before, after);
	expect(ops.filter((op) => op.type === "equal").length).toBe(500);
	expect(ops[ops.length - 1]).toEqual({ type: "insert", text: "appended" });
});

test("diffs words inside a changed block", () => {
	const ops = diffWords("the old body", "the new body");
	const removed = ops.filter((op) => op.type === "delete").map((op) => op.text);
	const inserted = ops
		.filter((op) => op.type === "insert")
		.map((op) => op.text);
	expect(removed.join("")).toContain("old");
	expect(inserted.join("")).toContain("new");
});

test("renders inserted text as ins and deleted text as del", () => {
	const blocks = diffHtml("<p>alpha beta</p>", "<p>alpha gamma</p>");
	const html = blocks.map((block) => block.html).join("");
	expect(html).toContain('<del class="wiki-diff-removed">beta</del>');
	expect(html).toContain('<ins class="wiki-diff-added">gamma</ins>');
	expect(blocks.every((block) => block.type === "change")).toBe(true);
});

test("passes unchanged blocks through as equal", () => {
	const blocks = diffHtml(
		"<p>same</p><p>before</p>",
		"<p>same</p><p>after</p>",
	);
	expect(blocks[0]).toEqual({
		type: "equal",
		html: '<p class="wiki-diff-equal">same</p>',
	});
	expect(blocks[1]?.type).toBe("change");
});

test("escapes HTML in the diff output", () => {
	const blocks = diffHtml("<p>&lt;script&gt;</p>", "<p>&lt;style&gt;</p>");
	const html = blocks.map((block) => block.html).join("");
	expect(html).not.toContain("<script>");
	expect(html).toContain("&lt;");
});

test("an added page reports every block as inserted", () => {
	const blocks = diffHtml(null, "<p>fresh</p>");
	expect(blocks).toEqual([
		{
			type: "change",
			html: '<p class="wiki-diff-change"><ins class="wiki-diff-added">fresh</ins></p>',
		},
	]);
});

test("a removed page reports every block as deleted", () => {
	const blocks = diffHtml("<p>gone</p>", null);
	expect(blocks[0]?.html).toContain(
		'<del class="wiki-diff-removed">gone</del>',
	);
});
