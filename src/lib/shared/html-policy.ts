/** What stored rich-text HTML may contain: the server sanitizer and the editor's unknown block both use it. */
export const allowedTags = [
	"a",
	"blockquote",
	"br",
	"code",
	"col",
	"colgroup",
	"del",
	"div",
	"em",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"img",
	"input",
	"ins",
	"label",
	"li",
	"ol",
	"p",
	"pre",
	"span",
	"strong",
	"sub",
	"sup",
	"table",
	"tbody",
	"td",
	"th",
	"thead",
	"tr",
	"u",
	"ul",
];

export const allowedAttributes: Record<string, string[]> = {
	a: ["href", "title", "class", "rel", "target", "data-user-id"],
	img: ["src", "alt", "title", "width", "height", "class"],
	ul: ["class", "data-type"],
	li: ["class", "data-type", "data-checked"],
	input: ["type", "checked", "disabled"],
	"*": ["class"],
};

export const allowedSchemes = ["http", "https", "mailto"];
export const imageSchemes = ["http", "https"];

/** A relative address, or one whose scheme is in `schemes`. Browsers ignore tabs, line breaks and spaces inside a scheme. */
export function isAllowedUrl(value: string, schemes: readonly string[]) {
	const url = [...value].filter((character) => character > " ").join("");
	if (url.startsWith("//")) return false;
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
	return scheme === undefined || schemes.includes(scheme);
}
