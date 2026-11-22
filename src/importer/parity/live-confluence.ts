import { createHash } from "node:crypto";
import { GetOnlyRequestError } from "../client.ts";
import type { ConfluenceClient } from "../confluence.ts";
import type { PrivateApiOptions } from "../private-apis.ts";
import { mapSpacePermission } from "../wiki-permissions.ts";
import { fetchPageSocial } from "../wiki-social.ts";
import type {
	ConfluenceContent,
	ConfluenceSpace,
	ConfluenceSpacePermissions,
	ConfluenceVersion,
} from "../wiki-types.ts";
import type {
	WikiAttachmentData,
	WikiAttachmentSample,
	WikiLivePageData,
	WikiLiveSnapshot,
} from "./types.ts";

const SAMPLE_SIZE = 20;

interface UserDirectory {
	byKey: Map<string, string>;
	usernames: Set<string>;
}

function dateOf(value: string | undefined | null) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resolveUsername(
	user: { userKey?: string | null; username?: string | null },
	directory: UserDirectory,
) {
	if (user.userKey) {
		const name = directory.byKey.get(user.userKey);
		if (name) return name;
	}
	if (user.username && directory.usernames.has(user.username)) {
		return user.username;
	}
	return null;
}

function restrictionsOf(
	content: ConfluenceContent,
	directory: UserDirectory,
): string[] {
	const result = new Set<string>();
	for (const operation of ["read", "update"] as const) {
		const restrictions = content.restrictions?.[operation]?.restrictions;
		for (const user of restrictions?.user?.results ?? []) {
			const name =
				resolveUsername(user, directory) ?? user.userKey ?? user.username;
			if (name) result.add(`${operation}:user:${name}`);
		}
		for (const group of restrictions?.group?.results ?? []) {
			if (group.name) result.add(`${operation}:group:${group.name}`);
		}
	}
	return [...result];
}

function labelsOf(content: ConfluenceContent) {
	return (content.metadata?.labels?.results ?? [])
		.map((label) => label.name)
		.filter((name): name is string => Boolean(name));
}

function pageFromContent(
	content: ConfluenceContent,
	spaceKey: string,
	status: WikiLivePageData["status"],
	type: WikiLivePageData["type"],
	directory: UserDirectory,
): WikiLivePageData {
	return {
		sourceId: content.id,
		spaceKey,
		status,
		type,
		parentSourceId: content.ancestors?.at(-1)?.id ?? null,
		position: 0,
		title: content.title ?? "",
		created: dateOf(content.history?.createdDate ?? content.version?.when),
		labels: labelsOf(content),
		restrictions: restrictionsOf(content, directory),
	};
}

function attachmentDownloadPath(
	link: string | undefined,
	version: number,
): string | null {
	if (!link) return null;
	const url = new URL(link, "https://confluence.invalid");
	url.searchParams.set("version", String(version));
	url.searchParams.delete("modificationDate");
	return `${url.pathname}${url.search}`;
}

async function fetchAttachmentVersions(
	client: ConfluenceClient,
	pageId: string,
): Promise<
	{
		sourceId: string;
		attachment: ConfluenceContent;
		version: ConfluenceVersion;
	}[]
> {
	const attachments = await client.listAttachments(pageId);
	const result: {
		sourceId: string;
		attachment: ConfluenceContent;
		version: ConfluenceVersion;
	}[] = [];
	for (const attachment of attachments) {
		let versions: ConfluenceVersion[] = [];
		try {
			versions = await client.listAttachmentVersions(attachment.id);
		} catch (error) {
			if (
				!(error instanceof GetOnlyRequestError) ||
				(error.status !== 403 && error.status !== 404)
			) {
				throw error;
			}
			versions = [];
		}
		if (versions.length === 0 && attachment.version) {
			versions = [attachment.version];
		}
		for (const version of versions) {
			result.push({
				sourceId: `${attachment.id}:${version.number}`,
				attachment,
				version,
			});
		}
	}
	return result;
}

async function downloadSample(
	client: ConfluenceClient,
	items: {
		sourceId: string;
		pageSourceId: string;
		attachment: ConfluenceContent;
		version: ConfluenceVersion;
	}[],
): Promise<WikiAttachmentSample[]> {
	const sorted = [...items].sort((left, right) =>
		left.sourceId.localeCompare(right.sourceId),
	);
	const samples: WikiAttachmentSample[] = [];
	for (const item of sorted.slice(0, SAMPLE_SIZE)) {
		const path = attachmentDownloadPath(
			item.attachment._links?.download,
			item.version.number,
		);
		if (!path) continue;
		try {
			const bytes = await client.download(path);
			samples.push({
				sourceId: item.sourceId,
				pageSourceId: item.pageSourceId,
				size: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		} catch (error) {
			console.warn(
				`Skipping attachment sample ${item.sourceId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return samples;
}

async function orderPages(
	client: ConfluenceClient,
	spaceKey: string,
	pages: WikiLivePageData[],
): Promise<Map<string, { parentSourceId: string | null; position: number }>> {
	const groups = new Map<string, WikiLivePageData[]>();
	for (const page of pages) {
		const key = `${page.parentSourceId ?? ""}\u0000${page.type}`;
		const group = groups.get(key) ?? [];
		group.push(page);
		groups.set(key, group);
	}
	const ordered = new Map<string, string[]>();
	if (pages.length > 0) {
		const roots = await client.listSpaceRootContent(spaceKey);
		ordered.set(
			"\u0000page",
			roots.page.map((page) => page.id),
		);
		ordered.set(
			"\u0000blogpost",
			roots.blogpost.map((page) => page.id),
		);
		const parentIds = new Set(
			pages
				.map((page) => page.parentSourceId)
				.filter((id): id is string => Boolean(id)),
		);
		await Promise.all(
			[...parentIds].map(async (parentId) => {
				const children = await client.listChildPages(parentId);
				ordered.set(
					`${parentId}\u0000page`,
					children.map((child) => child.id),
				);
			}),
		);
	}
	const tree = new Map<
		string,
		{ parentSourceId: string | null; position: number }
	>();
	for (const [key, group] of groups) {
		const order = ordered.get(key) ?? [];
		const byId = new Map(group.map((page) => [page.sourceId, page]));
		const sequence: WikiLivePageData[] = [];
		for (const id of order) {
			const page = byId.get(id);
			if (page) {
				sequence.push(page);
				byId.delete(id);
			}
		}
		const rest = [...byId.values()].sort((left, right) => {
			const leftCreated = left.created ?? "";
			const rightCreated = right.created ?? "";
			if (leftCreated !== rightCreated) {
				return leftCreated.localeCompare(rightCreated);
			}
			return left.sourceId.localeCompare(right.sourceId);
		});
		sequence.push(...rest);
		sequence.forEach((page, position) => {
			page.position = position;
			tree.set(page.sourceId, {
				parentSourceId: page.parentSourceId,
				position,
			});
		});
	}
	return tree;
}

export function spacePermissions(
	entries: ConfluenceSpacePermissions[],
	usernames: Map<string, string>,
	knownUsernames: Set<string> = new Set(usernames.values()),
): string[] {
	const directory = { byKey: usernames, usernames: knownUsernames };
	const result = new Set<string>();
	for (const entry of entries) {
		const permission = mapSpacePermission(
			entry.operation?.targetType,
			entry.operation?.operationKey,
		);
		const subject = entry.subject;
		if (!permission || !subject) continue;
		if (subject.type === "anonymous") {
			result.add(`${permission}:anonymous`);
		} else if (subject.type === "group") {
			if (subject.name) result.add(`${permission}:group:${subject.name}`);
		} else {
			const name = resolveUsername(subject, directory);
			if (name) result.add(`${permission}:user:${name}`);
		}
	}
	return [...result];
}

async function fetchSpacePages(
	client: ConfluenceClient,
	space: ConfluenceSpace,
	directory: UserDirectory,
	options: PrivateApiOptions,
): Promise<{
	pages: WikiLivePageData[];
	versions: Map<string, number>;
	comments: Map<string, { page: number; inline: number }>;
	attachments: Map<string, WikiAttachmentData[]>;
	attachmentItems: {
		sourceId: string;
		pageSourceId: string;
		attachment: ConfluenceContent;
		version: ConfluenceVersion;
	}[];
	permissions: string[];
	pageWatchers: Map<string, number>;
	spaceWatchers: number;
	pageLikes: Map<string, number>;
	socialShapeKeys: Set<string>;
}> {
	const pages: WikiLivePageData[] = [];
	for (const type of ["page", "blogpost"] as const) {
		for (const status of ["current", "trashed", "draft"] as const) {
			const listed = await client.listContent(space.key, type, status);
			for (const content of listed) {
				pages.push(
					pageFromContent(content, space.key, status, type, directory),
				);
			}
		}
	}

	const versions = new Map<string, number>();
	const comments = new Map<string, { page: number; inline: number }>();
	const attachments = new Map<string, WikiAttachmentData[]>();
	const pageWatchers = new Map<string, number>();
	const pageLikes = new Map<string, number>();
	const spaceWatchers = new Set<string>();
	const socialShapeKeys = new Set<string>();
	const attachmentItems: {
		sourceId: string;
		pageSourceId: string;
		attachment: ConfluenceContent;
		version: ConfluenceVersion;
	}[] = [];

	for (const page of pages) {
		const [pageComments, attachmentVersions, pageVersions, social] =
			await Promise.all([
				client.listComments(page.sourceId),
				fetchAttachmentVersions(client, page.sourceId),
				page.status === "current"
					? client.listVersions(page.sourceId)
					: Promise.resolve([]),
				fetchPageSocial(client, page.sourceId, page.status, options),
			]);
		const inline = pageComments.filter(
			(comment) =>
				comment.extensions?.location === "inline" ||
				comment.extensions?.inlineProperties !== undefined,
		).length;
		comments.set(page.sourceId, {
			page: pageComments.length - inline,
			inline,
		});
		versions.set(page.sourceId, pageVersions.length);
		for (const key of social.unexpectedKeys) socialShapeKeys.add(key);
		const watchers = new Set(
			social.watchers
				.map((user) => resolveUsername(user, directory))
				.filter((key): key is string => key !== null),
		);
		const likes = new Set(
			social.likes
				.map((user) => resolveUsername(user, directory))
				.filter((key): key is string => key !== null),
		);
		pageWatchers.set(page.sourceId, watchers.size);
		pageLikes.set(page.sourceId, likes.size);
		for (const watcher of social.spaceWatchers) {
			const key = resolveUsername(watcher, directory);
			if (key) spaceWatchers.add(key);
		}
		const pageAttachments: WikiAttachmentData[] = [];
		for (const item of attachmentVersions) {
			pageAttachments.push({
				sourceId: item.sourceId,
				size: 0,
				sha256: "",
			});
			attachmentItems.push({ ...item, pageSourceId: page.sourceId });
		}
		attachments.set(page.sourceId, pageAttachments);
	}

	const permissions = spacePermissions(
		await client.listSpacePermissions(space.key),
		directory.byKey,
		directory.usernames,
	);
	return {
		pages,
		versions,
		comments,
		attachments,
		attachmentItems,
		permissions,
		pageWatchers,
		spaceWatchers: spaceWatchers.size,
		pageLikes,
		socialShapeKeys,
	};
}

export async function fetchWikiLive(
	client: ConfluenceClient,
	options: PrivateApiOptions = {},
): Promise<WikiLiveSnapshot> {
	const [currentSpaces, archivedSpaces, users] = await Promise.all([
		client.listSpaces("current"),
		client.listSpaces("archived"),
		client.listUsers(),
	]);
	const directory: UserDirectory = {
		byKey: new Map<string, string>(),
		usernames: new Set<string>(),
	};
	for (const user of users) {
		if (user.username) directory.usernames.add(user.username);
		if (user.userKey && user.username) {
			directory.byKey.set(user.userKey, user.username);
		}
	}
	const spaces = [...currentSpaces, ...archivedSpaces];
	const pages = new Map<string, WikiLivePageData>();
	const versions = new Map<string, number>();
	const comments = new Map<string, { page: number; inline: number }>();
	const attachments = new Map<string, WikiAttachmentData[]>();
	const permissions = new Map<string, string[]>();
	const pageWatchers = new Map<string, number>();
	const spaceWatchers = new Map<string, number>();
	const pageLikes = new Map<string, number>();
	const socialShapeKeys = new Set<string>();
	const tree = new Map<
		string,
		{ parentSourceId: string | null; position: number }
	>();
	const attachmentItems: {
		sourceId: string;
		pageSourceId: string;
		attachment: ConfluenceContent;
		version: ConfluenceVersion;
	}[] = [];

	for (const space of spaces) {
		const data = await fetchSpacePages(client, space, directory, options);
		for (const page of data.pages) pages.set(page.sourceId, page);
		for (const [key, value] of data.versions) versions.set(key, value);
		for (const [key, value] of data.comments) comments.set(key, value);
		for (const [key, value] of data.attachments) attachments.set(key, value);
		for (const [key, value] of data.pageWatchers) pageWatchers.set(key, value);
		for (const [key, value] of data.pageLikes) pageLikes.set(key, value);
		for (const key of data.socialShapeKeys) socialShapeKeys.add(key);
		spaceWatchers.set(space.key, data.spaceWatchers);
		permissions.set(space.key, data.permissions);
		attachmentItems.push(...data.attachmentItems);
	}
	const orderedPages = [...pages.values()].filter(
		(page) => page.status === "current",
	);
	const orderTree = await orderPagesForSpaces(client, spaces, orderedPages);
	for (const [key, value] of orderTree) tree.set(key, value);

	return {
		spaces: spaces.map((space) => ({
			key: space.key,
			sourceId: String(space.id),
			status: space.status ?? "current",
		})),
		pages,
		versions,
		comments,
		attachments,
		attachmentSample: await downloadSample(client, attachmentItems),
		permissions,
		tree,
		pageWatchers,
		spaceWatchers,
		watchersSkipped: options.privateApis !== true,
		pageLikes,
		pageLikesSkipped: options.privateApis !== true,
		socialShapeKeys,
	};
}

async function orderPagesForSpaces(
	client: ConfluenceClient,
	spaces: ConfluenceSpace[],
	pages: WikiLivePageData[],
): Promise<Map<string, { parentSourceId: string | null; position: number }>> {
	const result = new Map<
		string,
		{ parentSourceId: string | null; position: number }
	>();
	for (const space of spaces) {
		const spacePages = pages.filter((page) => page.spaceKey === space.key);
		const tree = await orderPages(client, space.key, spacePages);
		for (const [key, value] of tree) result.set(key, value);
	}
	return result;
}
