import { expect, test } from "vitest";
import { finalizeHtml } from "../src/lib/server/wiki/render.ts";

test("a table of contents points at an author's heading id", () => {
	const html = finalizeHtml(
		'<h2 id="author-id">Title</h2><div class="wiki-toc" data-min-level="1" data-max-level="6"><div class="wiki-toc-title">Contents</div></div>',
	);
	expect(html).toContain('href="#author-id"');
	expect(html).not.toContain('href="#title"');
});
