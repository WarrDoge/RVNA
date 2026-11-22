import { afterEach, expect, test, vi } from "vitest";
import {
	DESCRIPTION_LIMIT,
	plainTextToHtml,
	truncate,
} from "../src/lib/server/messenger/text.ts";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

test("the description limit leaves room for the worst-case escaping", () => {
	const html = plainTextToHtml(truncate('"'.repeat(45_000), DESCRIPTION_LIMIT));
	expect(html.length).toBeLessThanOrEqual(200_000);
	expect(DESCRIPTION_LIMIT * 6).toBeLessThanOrEqual(200_000);
});

test("text within the limit is returned unchanged", () => {
	expect(truncate("hello", 5)).toBe("hello");
	expect(truncate("hello", 10)).toBe("hello");
});

test("truncate never returns more than the limit", () => {
	const cut = truncate("a".repeat(300), 255);
	expect(cut.length).toBe(255);
	expect(cut.endsWith("…")).toBe(true);

	const emoji = truncate("😀".repeat(300), 255);
	expect(emoji.length).toBeLessThanOrEqual(255);
	expect(emoji).toBe(`${"😀".repeat(127)}…`);

	const half = truncate("😀".repeat(300), 254);
	expect(half.length).toBeLessThanOrEqual(254);
	expect(half).toBe(`${"😀".repeat(126)}…`);
});

test("truncate does not walk a long input when the cut is short", () => {
	const input = "x".repeat(1_000_000);
	const original = String.prototype[Symbol.iterator];
	let iterated = 0;
	Object.defineProperty(String.prototype, Symbol.iterator, {
		configurable: true,
		value: function* (this: string) {
			for (let index = 0; index < this.length; index += 1) {
				iterated += 1;
				yield this[index];
			}
		},
	});
	let result = "";
	try {
		result = truncate(input, 10);
	} finally {
		Object.defineProperty(String.prototype, Symbol.iterator, {
			configurable: true,
			value: original,
		});
	}
	expect(result).toBe(`${"x".repeat(9)}…`);
	expect(iterated).toBe(0);
});

test("a blank ORIGIN falls back to APP_URL", async () => {
	vi.stubEnv("APP_URL", "https://rvna.example.com/");
	vi.stubEnv("ORIGIN", "");
	const { appOrigin } = await import("../src/lib/server/messenger/text.ts");
	expect(appOrigin()).toBe("https://rvna.example.com");
});

test("ORIGIN is the public origin when set", async () => {
	vi.stubEnv("APP_URL", "https://rvna.example.com");
	vi.stubEnv("ORIGIN", "https://chat.example.com/");
	const { appOrigin } = await import("../src/lib/server/messenger/text.ts");
	expect(appOrigin()).toBe("https://chat.example.com");
});

test("an ORIGIN without a scheme is refused", async () => {
	vi.stubEnv("APP_URL", "https://rvna.example.com");
	vi.stubEnv("ORIGIN", "example.com");
	const { appOrigin } = await import("../src/lib/server/messenger/text.ts");
	expect(() => appOrigin()).toThrow(/ORIGIN/);
});
