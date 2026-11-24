import {
	allowedAttributes,
	allowedSchemes,
	allowedTags,
	imageSchemes,
	isAllowedUrl,
} from "#lib/shared/html-policy.ts";

const kept = new Set(allowedTags);
// These go with everything inside them; any other tag the policy lacks keeps its children.
const dropped = new Set([
	"script",
	"style",
	"iframe",
	"frame",
	"frameset",
	"object",
	"embed",
	"applet",
	"noscript",
	"template",
	"textarea",
	"select",
	"svg",
	"math",
]);

function attributeAllowed(tag: string, name: string, value: string) {
	if (
		!allowedAttributes[tag]?.includes(name) &&
		!allowedAttributes["*"]?.includes(name)
	) {
		return false;
	}
	if (name === "href") return isAllowedUrl(value, allowedSchemes);
	if (name === "src") return isAllowedUrl(value, imageSchemes);
	return true;
}

function copyAllowed(from: ParentNode, into: ParentNode, doc: Document) {
	for (const node of from.childNodes) {
		if (node.nodeType === 3) {
			into.append(doc.createTextNode(node.textContent ?? ""));
			continue;
		}
		if (node.nodeType !== 1) continue;
		const element = node as Element;
		const tag = element.localName;
		if (dropped.has(tag)) continue;
		if (!kept.has(tag)) {
			copyAllowed(element, into, doc);
			continue;
		}
		const clean = doc.createElement(tag);
		for (const { name, value } of element.attributes) {
			if (attributeAllowed(tag, name, value)) clean.setAttribute(name, value);
		}
		if (tag === "a" && clean.hasAttribute("target")) {
			clean.setAttribute("rel", "noopener noreferrer");
		}
		if (tag === "input") clean.setAttribute("type", "checkbox");
		copyAllowed(element, clean, doc);
		into.append(clean);
	}
}

/**
 * What the server sanitizer would keep of `html`, copied into new elements of a document that
 * runs no script and loads nothing. The string is never parsed into the live page.
 */
export function safeFragment(html: string) {
	const source = new DOMParser().parseFromString(html, "text/html");
	const doc = document.implementation.createHTMLDocument("");
	const fragment = doc.createDocumentFragment();
	copyAllowed(source.body, fragment, doc);
	return fragment;
}

export function safeHtml(html: string) {
	const holder = document.implementation
		.createHTMLDocument("")
		.createElement("div");
	holder.append(safeFragment(html));
	return holder.innerHTML;
}

const activeTags = new Set([...dropped, "link", "meta", "base"]);
const urlAttributes = new Set([
	"href",
	"src",
	"xlink:href",
	"action",
	"formaction",
	"background",
	"poster",
]);
const pastedSchemes = [...allowedSchemes, "tel"];

/**
 * Pasted and dropped HTML loses everything that can run or load code: active elements, event
 * handler attributes, `srcdoc` and addresses with another scheme. The editor schema then keeps
 * only the part it knows.
 */
export function scrubPastedHtml(html: string) {
	const doc = new DOMParser().parseFromString(html, "text/html");
	for (const element of [...doc.body.querySelectorAll("*")]) {
		if (activeTags.has(element.localName)) {
			element.remove();
			continue;
		}
		for (const { name, value } of [...element.attributes]) {
			if (
				name.startsWith("on") ||
				name === "srcdoc" ||
				(urlAttributes.has(name) && !isAllowedUrl(value, pastedSchemes))
			) {
				element.removeAttribute(name);
			}
		}
	}
	return doc.body.innerHTML;
}
