import { describe, expect, test } from "vitest";
import { rewriteJiraUrl, sanitizeJiraHtml } from "../src/importer/html.ts";

const baseUrl = "https://jira.example.test";

describe("sanitizeJiraHtml", () => {
	test("drops scripts and event handlers", () => {
		const html = sanitizeJiraHtml(
			`<p>Hello<script>alert("fixture")</script><img src="${baseUrl}/secure/thumbnail/12345/picture.png" onerror="alert(1)"></p>`,
			baseUrl,
		);

		expect(html).not.toBeNull();
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onerror");
		expect(html).toContain('src="/api/attachments/12345"');
	});

	test("drops javascript URLs but keeps safe links", () => {
		const html = sanitizeJiraHtml(
			`<a href="javascript:alert(1)">bad</a><a href="${baseUrl}/browse/FIXT-2">good</a>`,
			baseUrl,
		);

		expect(html).not.toContain("javascript:");
		expect(html).toContain('href="/browse/FIXT-2"');
		expect(html).toContain(">good</a>");
	});

	test("rewrites attachment URLs to the attachment endpoint", () => {
		expect(
			rewriteJiraUrl(`${baseUrl}/secure/attachment/67890/fixture.pdf`, baseUrl),
		).toBe("/api/attachments/67890");
		expect(rewriteJiraUrl("/secure/thumbnail/67890/fixture.png", baseUrl)).toBe(
			"/api/attachments/67890",
		);
	});

	test("leaves external URLs and returns null for empty input", () => {
		expect(rewriteJiraUrl("https://example.test/page", baseUrl)).toBe(
			"https://example.test/page",
		);
		expect(sanitizeJiraHtml(null, baseUrl)).toBeNull();
		expect(sanitizeJiraHtml("", baseUrl)).toBeNull();
	});

	test("returns the value unchanged when the base address cannot be parsed", () => {
		expect(rewriteJiraUrl("/browse/FIXT-2", "jira.example.test")).toBe(
			"/browse/FIXT-2",
		);
	});

	test("rewrites links on a Jira deployment under a context path", () => {
		const context = "https://jira.example.test/jira";
		expect(rewriteJiraUrl("/jira/browse/FIXT-2", context)).toBe(
			"/browse/FIXT-2",
		);
		expect(
			rewriteJiraUrl(
				"https://jira.example.test/jira/secure/attachment/67890/fixture.pdf",
				context,
			),
		).toBe("/api/attachments/67890");
	});

	test("keeps the query string and hash of an issue link", () => {
		expect(
			rewriteJiraUrl(
				`${baseUrl}/browse/FIXT-2?focusedCommentId=123#comment-123`,
				baseUrl,
			),
		).toBe("/browse/FIXT-2?focusedCommentId=123#comment-123");
	});

	test("adds a safe rel to links that open another window", () => {
		const html = sanitizeJiraHtml(
			`<a href="https://example.test/page" target="_blank">example</a>`,
			baseUrl,
		);
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
	});
});
