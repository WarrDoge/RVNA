import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { type AnyColumn, eq, type SQL, sql } from "drizzle-orm";
import { storeAvatarFile } from "../shared/avatar-storage.ts";
import { imageTypeForFile, uploadImage } from "../shared/images.ts";
import type { CurrentUser } from "./auth.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { HttpError } from "./http.ts";
import { can } from "./permissions.ts";
import { issueTypes, priorities, projects, users } from "./schema.ts";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const PALETTE = [
	"#4C9AFF",
	"#2684FF",
	"#6554C0",
	"#8777D9",
	"#00A3BF",
	"#00875A",
	"#36B37E",
	"#FF991F",
	"#DE350B",
	"#B06500",
];

export function userAvatarUrl(id: string) {
	return `/api/avatars/users/${id}`;
}

export function projectAvatarUrl(id: string) {
	return `/api/avatars/projects/${id}`;
}

export function issueTypeAvatarUrl(id: string) {
	return `/api/avatars/issuetypes/${id}`;
}

export function priorityAvatarUrl(id: string) {
	return `/api/avatars/priorities/${id}`;
}

/** Avatar URLs are built here, so no API response carries a stored external one. */
export function userAvatarSql(id: AnyColumn | SQL) {
	return sql<
		string | null
	>`case when ${id} is null then null else '/api/avatars/users/' || ${id}::text end`;
}

export function projectAvatarSql(id: AnyColumn | SQL) {
	return sql<
		string | null
	>`case when ${id} is null then null else '/api/avatars/projects/' || ${id}::text end`;
}

export function issueTypeAvatarSql(
	id: AnyColumn | SQL,
	iconFile: AnyColumn | SQL,
) {
	return sql<
		string | null
	>`case when ${iconFile} is null then null else '/api/avatars/issuetypes/' || ${id}::text end`;
}

/** The URL the issue type icon component renders: a stored avatar or the chosen icon. */
export function issueTypeIconSql(
	id: AnyColumn | SQL,
	iconFile: AnyColumn | SQL,
	iconUrl: AnyColumn | SQL,
) {
	return sql<
		string | null
	>`case when ${iconFile} is null or ${iconUrl} like 'builtin:%' then ${iconUrl} else '/api/avatars/issuetypes/' || ${id}::text end`;
}

export function priorityIconSql(
	id: AnyColumn | SQL,
	iconFile: AnyColumn | SQL,
) {
	return sql<
		string | null
	>`case when ${iconFile} is null then null else '/api/avatars/priorities/' || ${id}::text end`;
}

export function avatarColour(id: string) {
	let hash = 0;
	for (let index = 0; index < id.length; index++) {
		hash = (hash * 31 + id.charCodeAt(index)) % 1_000_003;
	}
	return PALETTE[hash % PALETTE.length] as string;
}

export function initialsFor(displayName: string, username: string) {
	const initials = displayName
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
	return initials || username.slice(0, 2).toUpperCase() || "?";
}

export function firstLetter(name: string) {
	return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
}

function escapeXml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Generated avatars are plain shapes and text: no script, no foreignObject, no
 * external references, and the endpoint also sends `Content-Security-Policy:
 * sandbox`.
 */
export function userAvatarSvg(
	id: string,
	displayName: string,
	username: string,
) {
	const text = escapeXml(initialsFor(displayName, username));
	return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" role="img" aria-label="${text}">
<circle cx="24" cy="24" r="24" fill="${avatarColour(id)}"/>
<text x="24" y="24" dy="0.35em" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="19" font-weight="600" fill="#ffffff">${text}</text>
</svg>
`;
}

export function projectAvatarSvg(id: string, name: string) {
	const text = escapeXml(firstLetter(name));
	return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" role="img" aria-label="${text}">
<rect width="48" height="48" rx="6" fill="${avatarColour(id)}"/>
<text x="24" y="24" dy="0.35em" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="22" font-weight="600" fill="#ffffff">${text}</text>
</svg>
`;
}

export type AvatarSource =
	| {
			kind: "stored";
			path: string;
			contentType: string;
			svg: boolean;
	  }
	| { kind: "svg"; svg: string };

function avatarRoot() {
	return resolve(env.AVATARS_DIR);
}

function storedPath(file: string) {
	const root = avatarRoot();
	const path = resolve(join(root, file));
	return path.startsWith(root + sep) ? path : null;
}

async function storedAvatar(file: string) {
	const path = storedPath(file);
	if (!path) return null;
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) return null;
	const image = imageTypeForFile(path);
	if (!image) return null;
	return { path, contentType: image.contentType, svg: image.type === "svg" };
}

export async function userAvatar(
	_actor: CurrentUser,
	id: string,
): Promise<AvatarSource> {
	const [row] = await db
		.select({
			id: users.id,
			displayName: users.displayName,
			username: users.username,
			avatarFile: users.avatarFile,
		})
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Avatar not found");

	if (row.avatarFile) {
		const stored = await storedAvatar(row.avatarFile);
		if (stored) return { kind: "stored", ...stored };
	}

	return {
		kind: "svg",
		svg: userAvatarSvg(row.id, row.displayName, row.username),
	};
}

export async function projectAvatar(
	actor: CurrentUser,
	id: string,
): Promise<AvatarSource> {
	const [row] = await db
		.select({
			id: projects.id,
			key: projects.key,
			name: projects.name,
			leadId: projects.leadId,
			avatarFile: projects.avatarFile,
		})
		.from(projects)
		.where(eq(projects.id, id))
		.limit(1);
	if (!row) throw new HttpError(404, "Avatar not found");
	if (
		!(await can(actor, "BROWSE_PROJECTS", {
			id: row.id,
			key: row.key,
			leadId: row.leadId,
		}))
	) {
		throw new HttpError(404, "Avatar not found");
	}

	if (row.avatarFile) {
		const stored = await storedAvatar(row.avatarFile);
		if (stored) return { kind: "stored", ...stored };
	}

	return { kind: "svg", svg: projectAvatarSvg(row.id, row.name) };
}

export async function issueTypeAvatar(
	_actor: CurrentUser,
	id: string,
): Promise<AvatarSource> {
	const [row] = await db
		.select({ iconFile: issueTypes.iconFile })
		.from(issueTypes)
		.where(eq(issueTypes.id, id))
		.limit(1);
	if (!row?.iconFile) throw new HttpError(404, "Icon not found");

	const stored = await storedAvatar(row.iconFile);
	if (!stored) throw new HttpError(404, "Icon not found");
	return { kind: "stored", ...stored };
}

export async function priorityAvatar(
	_actor: CurrentUser,
	id: string,
): Promise<AvatarSource> {
	const [row] = await db
		.select({ iconFile: priorities.iconFile })
		.from(priorities)
		.where(eq(priorities.id, id))
		.limit(1);
	if (!row?.iconFile) throw new HttpError(404, "Icon not found");

	const stored = await storedAvatar(row.iconFile);
	if (!stored) throw new HttpError(404, "Icon not found");
	return { kind: "stored", ...stored };
}

export type AvatarUpload = {
	bytes: Buffer | null;
	tooLarge: boolean;
};

export async function uploadAvatar(
	actor: CurrentUser,
	username: string,
	read: () => Promise<AvatarUpload>,
): Promise<{ avatarUrl: string }> {
	const [target] = await db
		.select({ id: users.id, username: users.username })
		.from(users)
		.where(eq(users.username, username))
		.limit(1);
	if (!target) throw new HttpError(404, "User not found");
	if (target.id !== actor.id && !actor.isAdmin) {
		throw new HttpError(
			403,
			"Only the user or an administrator can change this avatar",
		);
	}

	const uploaded = await read();
	if (uploaded.tooLarge || (uploaded.bytes?.length ?? 0) > MAX_AVATAR_BYTES) {
		throw new HttpError(413, "Avatar must be 2 MB or smaller");
	}
	if (!uploaded.bytes) {
		throw new HttpError(400, "No avatar file was uploaded");
	}
	if (!uploadImage(uploaded.bytes)) {
		throw new HttpError(400, "Avatar must be a PNG, JPEG or WebP image");
	}

	const stored = await storeAvatarFile(env.AVATARS_DIR, uploaded.bytes);
	if (!stored) {
		throw new HttpError(400, "Avatar must be a PNG, JPEG or WebP image");
	}
	await db
		.update(users)
		.set({
			avatarFile: stored.file,
			avatarUrl: null,
			updatedAt: new Date(),
		})
		.where(eq(users.id, target.id));

	return {
		avatarUrl: `${userAvatarUrl(target.id)}?v=${stored.sha256.slice(0, 12)}`,
	};
}
