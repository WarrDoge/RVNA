import { describe, expect, test } from "vitest";
import {
	attachmentKey,
	collectMacroNames,
	rewriteStorageReferences,
	sanitizeWikiHtml,
	spaceTitleKey,
	type WikiLinkContext,
} from "../src/importer/wiki-html.ts";

const baseUrl = "https://confluence.example.test";

const ctx: WikiLinkContext = {
	pageIds: new Set(["100", "101"]),
	pageIdsBySpaceTitle: new Map([["FIX\u0000Child One", "101"]]),
	attachmentIds: new Map([[attachmentKey("100", "diagram.png"), "att-1"]]),
	userIdsByUsername: new Map([["alice", "user-1"]]),
	userIdsByUserKey: new Map([["uk-alice", "user-1"]]),
	userNamesByUserKey: new Map([["uk-alice", "Alice Anderson"]]),
};

describe("sanitizeWikiHtml", () => {
	test("rewrites attachment, page, mention and issue references", () => {
		const html = [
			'<p><a href="/download/attachments/100/diagram.png?version=2">diagram</a></p>',
			'<p><img src="https://confluence.example.test/download/attachments/100/diagram.png?version=2" /></p>',
			'<p><a href="/display/FIX/Child+One">Child One</a></p>',
			'<p><a href="/pages/viewpage.action?pageId=101">Child One old link</a></p>',
			'<p><a class="confluence-userlink user-mention" data-username="alice" href="/display/~alice">Alice Anderson</a></p>',
			'<p><a class="issue-link" href="https://jira.example.test/browse/ABC-12?src=confmacro">ABC-12</a></p>',
		].join("");

		const clean = sanitizeWikiHtml(html, ctx, baseUrl);
		expect(clean).toContain('href="/api/wiki/attachments/att-1"');
		expect(clean).toContain('src="/api/wiki/attachments/att-1"');
		expect(clean).toContain('href="/pages/viewpage.action?pageId=101"');
		expect(clean).toContain(
			'<span class="user-mention" data-user-id="user-1">Alice Anderson</span>',
		);
		expect(clean).toContain('href="/browse/ABC-12"');
		expect(clean).not.toContain("/display/");
		expect(clean).not.toContain("src=confmacro");
	});

	test("keeps unresolved mentions keyed by their source username", () => {
		const clean = sanitizeWikiHtml(
			'<p><a class="user-mention" data-username="carol" href="/display/~carol">Carol</a></p>',
			ctx,
			baseUrl,
		);
		expect(clean).toContain('data-user-key="carol"');
		expect(clean).toContain("Carol");
	});

	test("drops per-render session tokens from kept links", () => {
		const clean = sanitizeWikiHtml(
			'<p><a href="/pages/createpage.action?spaceKey=FIX&amp;title=New&amp;atl_token=abc123">New</a></p><p><a href="/plugins/recently-updated/changes.action?theme=social&amp;searchToken=42&amp;spaceKeys=FIX">More</a></p>',
			ctx,
			baseUrl,
		);
		expect(clean).not.toContain("atl_token");
		expect(clean).not.toContain("searchToken");
		expect(clean).toContain(
			'href="/pages/createpage.action?spaceKey=FIX&amp;title=New"',
		);
		expect(clean).toContain(
			'href="/plugins/recently-updated/changes.action?theme=social&amp;spaceKeys=FIX"',
		);
	});

	test("keeps unknown page links untouched", () => {
		const clean = sanitizeWikiHtml(
			'<p><a href="/display/FIX/Missing+Page">Missing</a></p>',
			ctx,
			baseUrl,
		);
		expect(clean).toContain('href="/display/FIX/Missing+Page"');
	});

	test("strips hostile markup but keeps its text", () => {
		const html = [
			'<script>alert("x")</script>',
			'<iframe src="https://evil.example.test"></iframe>',
			'<p onclick="steal()">safe <strong>bold</strong></p>',
			'<a href="javascript:alert(1)">click</a>',
			'<img src="x" onerror="steal()" />',
			"<style>body{display:none}</style>",
		].join("");
		const clean = sanitizeWikiHtml(html, ctx, baseUrl) ?? "";
		expect(clean).not.toContain("<script");
		expect(clean).not.toContain("<iframe");
		expect(clean).not.toContain("onclick");
		expect(clean).not.toContain("onerror");
		expect(clean).not.toContain("javascript:");
		expect(clean).not.toContain("<style");
		expect(clean).toContain("<strong>bold</strong>");
		expect(clean).toContain("safe");
	});

	test("returns null for empty input", () => {
		expect(sanitizeWikiHtml("", ctx, baseUrl)).toBeNull();
		expect(sanitizeWikiHtml(null, ctx, baseUrl)).toBeNull();
	});
});

describe("rewriteStorageReferences", () => {
	test("rewrites storage links, mentions, images and jira macros", () => {
		const storage = [
			'<p><ac:link><ri:page ri:content-title="Child One" ri:space-key="FIX" /></ac:link></p>',
			'<p><ac:link><ri:user ri:userkey="uk-alice" /></ac:link></p>',
			'<p><ac:image ac:alt="diagram"><ri:attachment ri:filename="diagram.png" /></ac:image></p>',
			'<p><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">ABC-12</ac:parameter></ac:structured-macro></p>',
			'<p><ac:macro ac:name="jira"><ac:parameter ac:name="key">ABC-13</ac:parameter></ac:macro></p>',
		].join("");

		const rewritten = rewriteStorageReferences(storage, ctx, "100");
		expect(rewritten).toContain('href="/pages/viewpage.action?pageId=101"');
		expect(rewritten).toContain(
			'<span class="user-mention" data-user-id="user-1">Alice Anderson</span>',
		);
		expect(rewritten).toContain('src="/api/wiki/attachments/att-1"');
		expect(rewritten).toContain('href="/browse/ABC-12"');
		expect(rewritten).toContain('href="/browse/ABC-13"');
		expect(rewritten).not.toContain("ac:structured-macro");
		expect(rewritten).not.toContain("ac:macro");
	});

	test("uses link text bodies and unresolved attachments", () => {
		const storage = [
			'<ac:link><ri:page ri:content-title="Child One" ri:space-key="FIX" /><ac:link-body>go here</ac:link-body></ac:link>',
			'<ac:image><ri:attachment ri:filename="missing.png" /></ac:image>',
		].join("");
		const rewritten = rewriteStorageReferences(storage, ctx, "100");
		expect(rewritten).toContain(">go here</a>");
		expect(rewritten).not.toContain("missing.png");
	});
});

describe("collectMacroNames", () => {
	test("reports every structured and old macro name", () => {
		const storage =
			'<ac:structured-macro ac:name="toc"></ac:structured-macro><ac:macro ac:name="widget"></ac:macro><ac:structured-macro ac:name="toc"></ac:structured-macro>';
		expect(collectMacroNames(storage)).toEqual(["toc", "widget", "toc"]);
		expect(collectMacroNames(null)).toEqual([]);
	});

	test("builds stable lookup keys", () => {
		expect(spaceTitleKey("FIX", "A/B")).toBe("FIX\u0000A/B");
		expect(attachmentKey("100", "a b.png")).toBe("100/a b.png");
	});
});

describe("wiki link decoding and origins", () => {
	test("keeps an encoded plus in a page title", () => {
		const plusCtx: WikiLinkContext = {
			...ctx,
			pageIdsBySpaceTitle: new Map([["FIX\u0000C++", "101"]]),
		};

		const clean = sanitizeWikiHtml(
			'<p><a href="/display/FIX/C%2B%2B">C++</a></p>',
			plusCtx,
			baseUrl,
		);

		expect(clean).toContain('href="/pages/viewpage.action?pageId=101"');
	});

	test("does not rewrite internal-looking links on another origin", () => {
		const clean = sanitizeWikiHtml(
			[
				'<p><a href="https://other.example.test/display/FIX/Child+One">page</a></p>',
				'<p><a href="https://evil.example.test/download/attachments/100/diagram.png">file</a></p>',
				'<p><img src="https://evil.example.test/download/attachments/100/diagram.png" /></p>',
				'<p><a href="https://jira.example.test/browse/ABC-12">ABC-12</a></p>',
			].join(""),
			ctx,
			baseUrl,
		);

		expect(clean).toContain(
			'href="https://other.example.test/display/FIX/Child+One"',
		);
		expect(clean).toContain(
			'href="https://evil.example.test/download/attachments/100/diagram.png"',
		);
		expect(clean).toContain(
			'src="https://evil.example.test/download/attachments/100/diagram.png"',
		);
		expect(clean).toContain('href="/browse/ABC-12"');
	});
});

describe("storage reference escaping", () => {
	test("escapes a display name used as a mention", () => {
		const maliciousCtx: WikiLinkContext = {
			...ctx,
			userNamesByUserKey: new Map([
				["uk-alice", '<img src="https://evil.example.test/track.png">'],
			]),
		};

		const rewritten = rewriteStorageReferences(
			'<ac:link><ri:user ri:userkey="uk-alice" /></ac:link>',
			maliciousCtx,
			"100",
		);

		expect(rewritten).not.toContain("<img");
		expect(rewritten).toContain("&lt;img");
	});

	test("decodes entities in link bodies before escaping them", () => {
		const rewritten = rewriteStorageReferences(
			'<ac:link><ri:page ri:content-title="A &amp; B" ri:space-key="FIX" /><ac:plain-text-link-body>go &lt;here&gt;</ac:plain-text-link-body></ac:link>',
			ctx,
			"100",
		);

		expect(rewritten).toContain("go &lt;here&gt;");
		expect(rewritten).not.toContain("&amp;lt;");
	});

	test("uses the file name when an attachment link cannot be resolved", () => {
		const rewritten = rewriteStorageReferences(
			'<ac:link><ri:attachment ri:filename="missing.png" /></ac:link>',
			ctx,
			"100",
		);

		expect(rewritten).not.toContain("ac:link");
		expect(rewritten).toContain("missing.png");
	});

	test("reads a plain link body, with or without CDATA, and ignores an unclosed one", () => {
		const link = (body: string) =>
			rewriteStorageReferences(
				`<ac:link><ri:page ri:content-title="Page" />${body}</ac:link>`,
				ctx,
				"100",
			);

		expect(
			link("<ac:plain-text-link-body> Plain </ac:plain-text-link-body>"),
		).toContain("<span>Plain</span>");
		expect(
			link(
				"<ac:plain-text-link-body> <![CDATA[Cdata text]]> </ac:plain-text-link-body>",
			),
		).toContain("<span>Cdata text</span>");
		expect(link("<ac:plain-text-link-body>Open")).toContain(
			"<span>Page</span>",
		);
	});

	test("handles a long run of spaces in a link body in linear time", () => {
		const started = performance.now();
		for (const body of [
			`<ac:plain-text-link-body>A${" ".repeat(100_000)}`,
			`<ac:plain-text-link-body><![CDATA[A${" ".repeat(100_000)}]]`,
			`<ac:plain-text-link-body>${" ]]>".repeat(25_000)}`,
		]) {
			rewriteStorageReferences(
				`<ac:link><ri:page ri:content-title="Page" />${body}</ac:link>`,
				ctx,
				"100",
			);
		}
		expect(performance.now() - started).toBeLessThan(1000);
	});

	test("does not let an image attribute break out of its value", () => {
		const rewritten = rewriteStorageReferences(
			'<ac:image ac:alt="x&quot; onerror=&quot;alert(1)"><ri:attachment ri:filename="diagram.png" /></ac:image>',
			ctx,
			"100",
		);
		const clean = sanitizeWikiHtml(rewritten, ctx, baseUrl) ?? "";

		expect(clean).toContain('src="/api/wiki/attachments/att-1"');
		expect(clean).not.toContain('onerror="');
		expect(clean).toContain('alt="x&quot; onerror=&quot;alert(1)"');
	});
});
