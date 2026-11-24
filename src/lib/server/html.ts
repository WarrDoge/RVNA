import { inArray } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { profileHref } from "../profile-link.ts";
import {
	allowedAttributes,
	allowedSchemes,
	allowedTags,
	imageSchemes,
} from "../shared/html-policy.ts";
import { db } from "./db.ts";
import { users } from "./schema.ts";

export { allowedAttributes, allowedTags };

/** A link that opens another window must not hand that window a reference to ours. */
export function withSafeRel(attributes: Record<string, string>) {
	return attributes.target
		? { ...attributes, rel: "noopener noreferrer" }
		: attributes;
}

type MentionUser = { displayName: string; username: string };

function cleanBodyHtml(
	html: string,
	users?: Map<string, MentionUser>,
	mentioned?: Set<string>,
) {
	return sanitizeHtml(html, {
		allowedTags,
		allowedAttributes,
		allowedSchemes,
		allowedSchemesByTag: { img: imageSchemes },
		allowProtocolRelative: false,
		transformTags: {
			a: (tagName: string, attributes: Record<string, string>) => {
				const classes = (attributes.class ?? "").split(/\s+/);
				const userId = attributes["data-user-id"];
				if (classes.includes(mentionClass) && userId) {
					if (mentioned && uuidPattern.test(userId)) mentioned.add(userId);
					const user = users?.get(userId);
					const attribs = { ...attributes };
					delete attribs.href;
					if (user) attribs.href = profileHref(user.username);
					return {
						tagName,
						attribs: withSafeRel(attribs),
						...(user ? { text: `@${user.displayName}` } : {}),
					};
				}
				return { tagName, attribs: withSafeRel(attributes) };
			},
			input: (tagName: string, attributes: Record<string, string>) => ({
				tagName,
				attribs: { ...attributes, type: "checkbox" },
			}),
		},
	}).trim();
}

export async function sanitizeBodyHtml(
	html: string | null | undefined,
): Promise<string | null> {
	if (!html) return null;

	const ids = new Set<string>();
	const clean = cleanBodyHtml(html, undefined, ids);
	if (clean === "") return null;
	if (ids.size === 0) return clean;

	const users = await loadMentionUsers([...ids]);
	if (users.size === 0) return clean;

	const rewritten = cleanBodyHtml(html, users);
	return rewritten === "" ? null : rewritten;
}

export const mentionClass = "user-hover";

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadMentionUsers(ids: string[]) {
	const rows = await db
		.select({
			id: users.id,
			displayName: users.displayName,
			username: users.username,
		})
		.from(users)
		.where(inArray(users.id, ids));
	return new Map<string, MentionUser>(
		rows.map((row) => [
			row.id,
			{ displayName: row.displayName, username: row.username },
		]),
	);
}

export function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

// Only the editor's mention node counts: a data-user-id on any other tag is not a mention.
export function extractMentionedUserIds(
	html: string | null | undefined,
): string[] {
	const ids = new Set<string>();
	const clean = cleanBodyHtml(html ?? "", undefined, ids);
	if (!clean) return [];
	return [...ids];
}

const blockBoundary =
	/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr|td|th|table|ul|ol|dl|dt|dd|section|article|header|footer|aside|nav|figure|figcaption|form|fieldset|address|details|summary|caption)\s*>/gi;
const lineBreak = /<br\b[^>]*>/gi;
const horizontalRule = /<hr\b[^>]*>/gi;

export function htmlToText(html: string | null | undefined): string {
	if (!html) return "";
	const withBreaks = html
		.replace(lineBreak, "\n")
		.replace(horizontalRule, "\n")
		.replace(blockBoundary, "\n");
	return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
