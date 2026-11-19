import sanitizeHtml from "sanitize-html";
import { allowedAttributes, allowedTags } from "../lib/server/html.ts";

const issueKeyPattern = /^\/browse\/([A-Z][A-Z0-9_]*-\d+)$/;
const attachmentPattern = /^\/secure\/(?:attachment|thumbnail)\/(\d+)(?:\/|$)/;

export function rewriteJiraUrl(value: string, baseUrl: string): string {
	let url: URL;
	try {
		url = new URL(value, baseUrl);
	} catch {
		return value;
	}

	const base = new URL(baseUrl);
	if (url.origin !== base.origin) return value;

	const issue = url.pathname.match(issueKeyPattern);
	if (issue) return `/browse/${issue[1]}${url.hash}`;

	const attachment = url.pathname.match(attachmentPattern);
	if (attachment) return `/api/attachments/${attachment[1]}`;

	return value;
}

function rewriteAttribute(
	attribs: sanitizeHtml.Attributes,
	name: string,
	baseUrl: string,
) {
	const value = attribs[name];
	if (!value) return attribs;
	return { ...attribs, [name]: rewriteJiraUrl(value, baseUrl) };
}

export function sanitizeJiraHtml(
	html: string | null | undefined,
	baseUrl: string,
): string | null {
	if (!html) return null;

	const clean = sanitizeHtml(html, {
		allowedTags,
		allowedAttributes,
		allowedSchemes: ["http", "https", "mailto"],
		allowedSchemesByTag: { img: ["http", "https"] },
		allowProtocolRelative: false,
		transformTags: {
			a: (tagName, attribs) => ({
				tagName,
				attribs: rewriteAttribute(attribs, "href", baseUrl),
			}),
			img: (tagName, attribs) => ({
				tagName,
				attribs: rewriteAttribute(attribs, "src", baseUrl),
			}),
		},
	}).trim();

	return clean === "" ? null : clean;
}
