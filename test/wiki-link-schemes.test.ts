import { expect, test } from "vitest";
import { checkDoc } from "../src/lib/server/wiki-edit/content.ts";
import { validateDoc, type WikiDoc } from "../src/lib/shared/wiki/index.ts";
import { normalizeUrl } from "../src/lib/wiki/editor/link-attrs.ts";

const linked = (href: string | null): WikiDoc => ({
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: "link",
					marks: [{ type: "link", attrs: { href, ref: null } }],
				},
			],
		},
	],
});

const refused = [
	"javascript:alert(1)",
	" JaVaScRiPt:alert(1)",
	"data:text/html,<script>alert(1)</script>",
	"vbscript:msgbox(1)",
	"ftp://example.com/file",
	"//example.com/x",
];
const accepted = [
	"https://example.com/a?b=1#c",
	"http://example.com",
	"mailto:me@example.com",
	"tel:+3581234567",
	"/pages/viewpage.action?pageId=1",
	"#anchor",
	"relative/path",
];

test.each(refused)("a link to %s is refused in a document", (href) => {
	expect(validateDoc(linked(href))).toBe("invalid link address");
	expect(() => checkDoc(linked(href))).toThrowError(/Invalid document/);
});

test.each(accepted)("a link to %s is kept in a document", (href) => {
	expect(validateDoc(linked(href))).toBeNull();
});

test("a link without an address is still a valid document", () => {
	expect(validateDoc(linked(null))).toBeNull();
});

test.each(refused.filter((href) => href.includes(":")))(
	"the link dialog does not accept %s",
	(href) => {
		expect(normalizeUrl(href)).toBe("");
	},
);

test("the link dialog still adds a scheme and keeps good addresses", () => {
	expect(normalizeUrl("example.com/a")).toBe("https://example.com/a");
	expect(normalizeUrl("me@example.com")).toBe("mailto:me@example.com");
	expect(normalizeUrl("/pages/viewpage.action?pageId=1")).toBe(
		"/pages/viewpage.action?pageId=1",
	);
});
