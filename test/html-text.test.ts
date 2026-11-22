import { expect, test } from "vitest";
import { htmlToText } from "../src/lib/server/html.ts";

test("block boundaries and line breaks become newlines", () => {
	expect(htmlToText("<p>a</p><p>b</p>")).toBe("a\nb");
	expect(htmlToText("a<br>b")).toBe("a\nb");
	expect(htmlToText("a<hr>b")).toBe("a\nb");
	expect(htmlToText("<ul><li>a</li><li>b</li></ul>")).toBe("a\nb");
	expect(htmlToText("<div>a</div><div>b</div>")).toBe("a\nb");
	expect(htmlToText("<p>a</p>text")).toBe("a\ntext");
	expect(htmlToText("<p>A &amp; B &lt;x&gt;</p>")).toBe("A & B <x>");
});
