import { expect, test } from "vitest";
import { truncate } from "../src/lib/server/notification-text.ts";

test("truncating keeps a surrogate pair whole", () => {
	const text = `${"a".repeat(298)}😀b`;
	expect(truncate(text, 300)).toBe(text);
});

test("truncating counts characters, not UTF-16 code units", () => {
	const text = `${"a".repeat(300)}😀`;
	const result = truncate(text, 300);
	expect(result).toBe(`${"a".repeat(299)}…`);
	expect([...(result as string)]).toHaveLength(300);
});

test("a blank value has no text", () => {
	expect(truncate(null)).toBeNull();
	expect(truncate(undefined)).toBeNull();
	expect(truncate("   ")).toBeNull();
});
