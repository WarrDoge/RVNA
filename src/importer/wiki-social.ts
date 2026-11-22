import { GetOnlyRequestError } from "./client.ts";
import type { ConfluenceClient } from "./confluence.ts";
import { type PrivateApiOptions, skipPrivateApi } from "./private-apis.ts";
import type { WikiSocialUser } from "./wiki-types.ts";

export interface WikiPageSocial {
	watchers: WikiSocialUser[];
	spaceWatchers: WikiSocialUser[];
	likes: WikiSocialUser[];
	/** Top-level keys of a response that did not have the expected shape. */
	unexpectedKeys: string[];
}

function text(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function objectOf(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** Confluence sends `name` in some responses and `username` in others. */
export function toSocialUser(value: unknown): WikiSocialUser | null {
	const user = objectOf(value);
	if (!user) return null;
	const username = text(user.name) ?? text(user.username);
	const userKey = text(user.userKey) ?? text(user.key);
	if (!username && !userKey) return null;
	return {
		userKey,
		username,
		displayName:
			text(user.fullName) ?? text(user.displayName) ?? username ?? userKey,
		avatarUrl:
			text(user.avatarUrl) ?? text(objectOf(user.profilePicture)?.path),
	};
}

export function socialUserKey(user: WikiSocialUser): string {
	return user.userKey ?? user.username ?? user.displayName ?? "";
}

function responseKeys(value: unknown): string[] {
	if (Array.isArray(value)) return ["[array]"];
	const object = objectOf(value);
	if (object) return Object.keys(object);
	return [`[${value === null ? "null" : typeof value}]`];
}

function arrayOf(value: unknown): unknown[] | null {
	return Array.isArray(value) ? value : null;
}

function collectUsers(
	values: unknown[] | null,
	extract: (entry: unknown) => unknown,
): WikiSocialUser[] {
	const users = new Map<string, WikiSocialUser>();
	for (const entry of values ?? []) {
		const user = toSocialUser(extract(entry));
		if (!user) continue;
		const key = socialUserKey(user);
		if (key) users.set(key, user);
	}
	return [...users.values()];
}

function parseUsers(value: unknown): WikiSocialUser[] {
	return collectUsers(arrayOf(value), (entry) => entry);
}

function parseLikes(value: unknown): WikiSocialUser[] {
	return collectUsers(
		arrayOf(value),
		(entry) => objectOf(entry)?.user ?? entry,
	);
}

function noneWhenMissing(none: unknown) {
	return (error: unknown) => {
		if (
			error instanceof GetOnlyRequestError &&
			(error.status === 403 || error.status === 404)
		) {
			return none;
		}
		throw error;
	};
}

/**
 * The watcher and like endpoints are not part of Confluence's public REST API
 * and their payload is not documented. Anything unexpected is treated as
 * empty and reported once by the caller.
 */
export async function fetchPageSocial(
	client: ConfluenceClient,
	pageId: string,
	status = "current",
	options: PrivateApiOptions = {},
): Promise<WikiPageSocial> {
	// Confluence answers 404 for a draft or a trashed page, and for a page it will not show.
	if (status !== "current") {
		return { watchers: [], spaceWatchers: [], likes: [], unexpectedKeys: [] };
	}
	if (skipPrivateApi(options, "page watchers and likes")) {
		return { watchers: [], spaceWatchers: [], likes: [], unexpectedKeys: [] };
	}
	const [watchersResponse, likesResponse] = await Promise.all([
		client
			.getJson<unknown>("/json/listwatchers.action", { pageId })
			.catch(noneWhenMissing({ pageWatchers: [], spaceWatchers: [] })),
		client
			.getJson<unknown>(
				`/rest/likes/1.0/content/${encodeURIComponent(pageId)}/likes`,
			)
			.catch(noneWhenMissing({ likes: [] })),
	]);

	const unexpectedKeys: string[] = [];
	const watcherObject = objectOf(watchersResponse);
	const watchers = arrayOf(watcherObject?.pageWatchers);
	const spaceWatchers = arrayOf(watcherObject?.spaceWatchers);
	if (!watchers || !spaceWatchers) {
		unexpectedKeys.push(...responseKeys(watchersResponse));
	}

	const likesObject = objectOf(likesResponse);
	const likes = arrayOf(likesObject?.likes);
	if (!likes) unexpectedKeys.push(...responseKeys(likesResponse));

	return {
		watchers: parseUsers(watchers),
		spaceWatchers: parseUsers(spaceWatchers),
		likes: parseLikes(likes),
		unexpectedKeys,
	};
}
