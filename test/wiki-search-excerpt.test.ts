import { expect, test } from "vitest";
import { excerpt } from "../src/lib/server/wiki/search.ts";

test("highlighting never runs over escaped markup", () => {
	expect(excerpt("<p>a &amp; b</p>", "amp")).toBe("a &amp; b");
	const highlighted = excerpt("<p>mark ar</p>", "mark ar");
	expect(highlighted).not.toContain("<<mark>");
	expect(highlighted).toBe("<mark>mark</mark> <mark>ar</mark>");
});
