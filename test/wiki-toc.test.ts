import { expect, test } from "vitest";
import { finalizeHtml } from "../src/lib/server/wiki/render.ts";

test("a table of contents points at an author's heading id", () => {
	const html = finalizeHtml(
		'<h2 id="author-id">Title</h2><div class="wiki-toc" data-min-level="1" data-max-level="6"><div class="wiki-toc-title">Contents</div></div>',
	);
	expect(html).toContain('href="#author-id"');
	expect(html).not.toContain('href="#title"');
});

test("a heading does not reuse an id elsewhere in the body", () => {
	const html = finalizeHtml('<div id="intro"></div><h2>Intro</h2>');
	expect(html.match(/id="intro"/g)).toHaveLength(1);
	expect(html).toContain('<h2 id="intro-2">Intro</h2>');
});

test("a heading does not reuse an id that appears after it", () => {
	const html = finalizeHtml('<h2>Intro</h2><div id="intro"></div>');
	expect(html.match(/id="intro"/g)).toHaveLength(1);
	expect(html).toContain('<h2 id="intro-2">Intro</h2>');
});

test("a data attribute is not mistaken for an element id", () => {
	const html = finalizeHtml('<div data-page-id="intro"></div><h2>Intro</h2>');
	expect(html).toContain('<h2 id="intro">Intro</h2>');
});
