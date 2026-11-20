import { inArray } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { profileHref } from "../profile-link.ts";
import { db } from "./db.ts";
import { users } from "./schema.ts";

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

export const allowedAttributes: sanitizeHtml.IOptions["allowedAttributes"] = {
	a: ["href", "title", "class", "rel", "target", "data-user-id"],
	img: ["src", "alt", "title", "width", "height", "class"],
	ul: ["class", "data-type"],
	li: ["class", "data-type", "data-checked"],
	input: ["type", "checked", "disabled"],
	"*": ["class"],
};

/** A link that opens another window must not hand that window a reference to ours. */
export function withSafeRel(attributes: Record<string, string>) {
	return attributes.target
		? { ...attributes, rel: "noopener noreferrer" }
		: attributes;
}

type MentionUser = { displayName: string; username: string };

function cleanBodyHtml(html: string, users?: Map<string, MentionUser>) {
	return sanitizeHtml(html, {
		allowedTags,
		allowedAttributes,
		allowedSchemes: ["http", "https", "mailto"],
		allowedSchemesByTag: { img: ["http", "https"] },
		allowProtocolRelative: false,
		transformTags: {
			a: (tagName: string, attributes: Record<string, string>) => {
				const classes = (attributes.class ?? "").split(/\s+/);
				const userId = attributes["data-user-id"];
				if (classes.includes(mentionClass) && userId) {
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
		},
	}).trim();
}

export async function sanitizeBodyHtml(
	html: string | null | undefined,
): Promise<string | null> {
	if (!html) return null;

	const clean = cleanBodyHtml(html);
	if (clean === "") return null;

	const ids = mentionIds(clean);
	if (ids.length === 0) return clean;

	const users = await loadMentionUsers(ids);
	if (users.size === 0) return clean;

	const rewritten = cleanBodyHtml(html, users);
	return rewritten === "" ? null : rewritten;
}

export const mentionClass = "user-hover";

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mentionIds(clean: string): string[] {
	const ids = new Set<string>();
	sanitizeHtml(clean, {
		allowedTags,
		allowedAttributes,
		onOpenTag(name, attributes) {
			if (name !== "a") return;
			const classes = (attributes.class ?? "").split(/\s+/);
			const userId = attributes["data-user-id"];
			if (
				classes.includes(mentionClass) &&
				userId &&
				uuidPattern.test(userId)
			) {
				ids.add(userId);
			}
		},
	});
	return [...ids];
}

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
	const clean = cleanBodyHtml(html ?? "");
	if (!clean) return [];
	return mentionIds(clean);
}

export function htmlToText(html: string | null | undefined): string {
	if (!html) return "";
	return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
