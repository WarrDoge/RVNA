import { expect, test } from "vitest";
import { httpUrl } from "../src/lib/issue-form/custom-field-values.ts";

test("only absolute http(s) custom-field URLs are clickable", () => {
	expect(httpUrl("https://example.test/path")).toBe(
		"https://example.test/path",
	);
	expect(httpUrl("http://example.test")).toBe("http://example.test");
	expect(httpUrl("javascript:alert(1)")).toBeNull();
	expect(httpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
	expect(httpUrl("/relative")).toBeNull();
	expect(httpUrl("not a url")).toBeNull();
});
