import { expect, test } from "vitest";
import {
	htmlToText,
	pageTitleHref,
	textToHtml,
} from "../src/lib/wiki/format.ts";

test("page titles are encoded once, without turning spaces into plus signs", () => {
	expect(pageTitleHref("FIX", "A B")).toBe("/display/FIX/A%20B");
	expect(pageTitleHref("FIX", "A+B")).toBe("/display/FIX/A%2BB");
	expect(pageTitleHref("FIX", "50%20 off")).toBe("/display/FIX/50%2520%20off");
});

test("comment text survives the HTML round trip", () => {
	expect(htmlToText("<p>A &amp; B &lt;x&gt;</p>")).toBe("A & B <x>");
	expect(htmlToText(textToHtml("A & B <x>"))).toBe("A & B <x>");
});
