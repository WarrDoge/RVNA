import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathSegment } from "./client.ts";
import type { ConfluenceClient } from "./confluence.ts";
import type { PrivateApiOptions } from "./private-apis.ts";
import { collectMacroNames } from "./wiki-html.ts";
import { mapSpacePermission, spacePermissionKey } from "./wiki-permissions.ts";
import { fetchPageSocial, socialUserKey } from "./wiki-social.ts";
import type {
	ConfluenceContent,
	ConfluenceUserRef,
	ConfluenceVersion,
	WikiAttachment,
	WikiComment,
	WikiPage,
	WikiRestriction,
	WikiSocialUser,
	WikiSpace,
	WikiSpaceData,
	WikiSpacePermission,
	WikiUser,
	WikiVersion,
} from "./wiki-types.ts";

export interface ExistingAttachment {
	storagePath: string;
	sha256: string;
	size: number;
}

export interface WikiFetchOptions extends PrivateApiOptions {
	attachmentsDir: string;
	skipAttachments: boolean;
	spaceKeys?: string[];
	existingAttachments?: Map<string, ExistingAttachment>;
}

export interface WikiFetchResult {
	spaces: WikiSpaceData[];
	users: WikiUser[];
	macros: Map<string, Set<string>>;
	skippedPermissions: Map<string, number>;
	socialShapeKeys: Set<string>;
}

function pageError(sourceId: string, error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return new Error(`page ${sourceId}: ${message}`);
}

function userRefKey(user: ConfluenceUserRef | undefined) {
	return user?.userKey ?? user?.username ?? null;
}

function dateOf(value: string | undefined | null) {
	return value ? new Date(value) : null;
}

function toSpace(space: {
	id: number | string;
	key: string;
	name: string;
	type?: string;
	status?: string;
	description?: { view?: { value?: string }; plain?: { value?: string } };
	homepage?: { id?: string };
	icon?: { path?: string };
	creator?: ConfluenceUserRef;
	creationDate?: string;
}): WikiSpace {
	return {
		sourceId: String(space.id),
		key: space.key,
		name: space.name,
		type: space.type === "personal" ? "personal" : "global",
		status: space.status === "archived" ? "archived" : "current",
		descriptionHtml: space.description?.view?.value ?? null,
		homePageSourceId: space.homepage?.id ?? null,
		creatorUserKey: userRefKey(space.creator),
		created: dateOf(space.creationDate),
		iconPath: space.icon?.path ?? null,
	};
}

function contentStorage(content: ConfluenceContent) {
	return content.body?.storage?.value ?? "";
}

function contentView(content: ConfluenceContent) {
	return content.body?.view?.value ?? content.body?.export_view?.value ?? "";
}

function restrictionsOf(content: ConfluenceContent): WikiRestriction[] {
	const result: WikiRestriction[] = [];
	for (const operation of ["read", "update"] as const) {
		const restrictions = content.restrictions?.[operation]?.restrictions;
		for (const user of restrictions?.user?.results ?? []) {
			const key = userRefKey(user);
			if (key) result.push({ operation, userKey: key, groupName: null });
		}
		for (const group of restrictions?.group?.results ?? []) {
			if (group.name)
				result.push({ operation, userKey: null, groupName: group.name });
		}
	}
	return result;
}

function toVersion(
	version: ConfluenceVersion,
	content: { title?: string; storage: string; view: string },
): WikiVersion {
	return {
		number: version.number,
		title: content.title ?? "",
		storage: content.storage,
		view: content.view,
		authorUserKey: userRefKey(version.by),
		created: dateOf(version.when),
		message: version.message ?? "",
		minorEdit: version.minorEdit ?? false,
	};
}

export function toComment(content: ConfluenceContent): WikiComment {
	const ancestors = content.ancestors ?? [];
	return {
		sourceId: content.id,
		parentSourceId: ancestors.at(-1)?.id ?? null,
		authorUserKey: userRefKey(
			content.history?.createdBy ?? content.version?.by,
		),
		storage: contentStorage(content),
		view: contentView(content),
		created: dateOf(content.history?.createdDate ?? content.version?.when),
		updated: dateOf(content.version?.when ?? content.history?.createdDate),
		inline:
			content.extensions?.location === "inline" ||
			content.extensions?.inlineProperties !== undefined,
		inlineOriginalSelection:
			content.extensions?.inlineProperties?.originalSelection ?? null,
		inlineMarkerRef: content.extensions?.inlineProperties?.markerRef ?? null,
		resolved: content.extensions?.resolution?.status === "resolved",
	};
}

function toSpacePermission(entry: {
	operation?: { operationKey?: string; targetType?: string };
	subject?: {
		type?: string;
		userKey?: string;
		username?: string;
		name?: string;
	};
}): WikiSpacePermission | null {
	const permission = mapSpacePermission(
		entry.operation?.targetType,
		entry.operation?.operationKey,
	);
	const subject = entry.subject;
	if (!permission || !subject) return null;
	if (subject.type === "anonymous") {
		return { permission, userKey: null, groupName: null, anonymous: true };
	}
	if (subject.type === "group") {
		return {
			permission,
			userKey: null,
			groupName: subject.name ?? null,
			anonymous: false,
		};
	}
	return {
		permission,
		userKey: subject.userKey ?? subject.username ?? null,
		groupName: null,
		anonymous: false,
	};
}

function toUser(user: ConfluenceUserRef): WikiUser | null {
	if (!user.username) return null;
	return {
		userKey: user.userKey ?? null,
		username: user.username,
		displayName: user.displayName ?? user.username,
		email: user.email ?? user.emailAddress ?? null,
		avatarUrl: user.profilePicture?.path ?? null,
		active: user.active !== false && user.deleted !== true,
	};
}

async function fetchUsers(client: ConfluenceClient): Promise<WikiUser[]> {
	const users = await client.listUsers();
	const mapped: WikiUser[] = [];
	for (const user of users) {
		const wikiUser = toUser(user);
		if (wikiUser) mapped.push(wikiUser);
	}
	return mapped;
}

async function orderContent(
	client: ConfluenceClient,
	spaceKey: string,
	pages: WikiPage[],
): Promise<void> {
	const groups = new Map<string, WikiPage[]>();
	for (const page of pages) {
		const key = `${page.parentSourceId ?? ""}\u0000${page.type}`;
		const group = groups.get(key);
		if (group) group.push(page);
		else groups.set(key, [page]);
	}

	const ordered = new Map<string, string[]>();
	const current = pages.filter((page) => page.status === "current");
	if (current.length > 0) {
		const roots = await client.listSpaceRootContent(spaceKey);
		ordered.set(
			`\u0000page`,
			roots.page.map((page) => page.id),
		);
		ordered.set(
			`\u0000blogpost`,
			roots.blogpost.map((page) => page.id),
		);

		const parentIds = new Set<string>();
		for (const page of current) {
			if (page.parentSourceId) parentIds.add(page.parentSourceId);
		}
		await Promise.all(
			[...parentIds].map(async (parentId) => {
				const children = await client.listChildPages(parentId);
				ordered.set(
					`${parentId}\u0000page`,
					children.map((c) => c.id),
				);
			}),
		);
	}

	for (const [key, group] of groups) {
		const order = ordered.get(key) ?? [];
		const byId = new Map(group.map((page) => [page.sourceId, page]));
		const sequence: WikiPage[] = [];
		for (const id of order) {
			const page = byId.get(id);
			if (page) {
				sequence.push(page);
				byId.delete(id);
			}
		}
		const rest = [...byId.values()].sort((a, b) => {
			const left = a.created?.getTime() ?? 0;
			const right = b.created?.getTime() ?? 0;
			if (left !== right) return left - right;
			return a.sourceId.localeCompare(b.sourceId);
		});
		sequence.push(...rest);
		sequence.forEach((page, index) => {
			page.position = index;
		});
	}
}

async function fetchVersions(
	client: ConfluenceClient,
	content: ConfluenceContent,
): Promise<WikiVersion[]> {
	if (content.status !== "current") return [];

	const versions = await client.listVersions(content.id);
	const mapped: WikiVersion[] = [];
	for (const version of versions) {
		if (version.number === content.version?.number) {
			mapped.push(
				toVersion(version, {
					title: content.title,
					storage: contentStorage(content),
					view: contentView(content),
				}),
			);
			continue;
		}
		const historical = await client.getHistoricalVersion(
			content.id,
			version.number,
		);
		mapped.push(
			toVersion(version, {
				title: historical.title,
				storage: contentStorage(historical),
				view: contentView(historical),
			}),
		);
	}
	return mapped.sort((a, b) => a.number - b.number);
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

export async function fetchAttachments(
	client: ConfluenceClient,
	pageId: string,
	options: WikiFetchOptions,
): Promise<WikiAttachment[]> {
	if (options.skipAttachments) return [];

	const attachments = await client.listAttachments(pageId);
	const result: WikiAttachment[] = [];
	for (const attachment of attachments) {
		const fileName = attachment.title ?? "";
		const mimeType =
			attachment.metadata?.mediaType ??
			attachment.extensions?.mediaType ??
			null;
		let versions: ConfluenceVersion[] = [];
		try {
			versions = await client.listAttachmentVersions(attachment.id);
		} catch {
			versions = [];
		}
		if (versions.length === 0 && attachment.version) {
			versions = [attachment.version];
		}
		for (const version of versions) {
			const sourceId = `${attachment.id}:${version.number}`;
			const existing = options.existingAttachments?.get(sourceId);
			if (existing) {
				try {
					const info = await stat(
						join(options.attachmentsDir, existing.storagePath),
					);
					const cached =
						info.isFile() && info.size === existing.size
							? await readFile(
									join(options.attachmentsDir, existing.storagePath),
								)
							: null;
					if (
						cached &&
						createHash("sha256").update(cached).digest("hex") ===
							existing.sha256
					) {
						result.push({
							sourceId,
							attachmentId: attachment.id,
							fileName,
							mimeType,
							size: existing.size,
							version: version.number,
							authorUserKey: userRefKey(version.by),
							created: dateOf(version.when),
							comment: version.message ?? null,
							storagePath: existing.storagePath,
							sha256: existing.sha256,
						});
						continue;
					}
				} catch {
					// Download the missing file again.
				}
			}

			const path = attachmentDownloadPath(
				attachment._links?.download,
				version.number,
			);
			if (!path) {
				throw new Error(`attachment ${attachment.id} has no download link`);
			}
			const bytes = await client.download(path);
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			const storagePath = join(
				sha256,
				pathSegment(`${attachment.id}-${version.number}`),
			);
			const target = join(options.attachmentsDir, storagePath);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, bytes);

			result.push({
				sourceId,
				attachmentId: attachment.id,
				fileName,
				mimeType,
				size: bytes.length,
				version: version.number,
				authorUserKey: userRefKey(version.by),
				created: dateOf(version.when),
				comment: version.message ?? null,
				storagePath,
				sha256,
			});
		}
	}
	return result;
}

async function fetchPage(
	client: ConfluenceClient,
	content: ConfluenceContent,
	options: WikiFetchOptions,
): Promise<{
	page: WikiPage;
	spaceWatchers: WikiSocialUser[];
	unexpectedKeys: string[];
}> {
	const [comments, versions, attachments, social] = await Promise.all([
		client.listComments(content.id),
		fetchVersions(client, content),
		fetchAttachments(client, content.id, options),
		fetchPageSocial(client, content.id, content.status, options),
	]);
	const mappedComments = comments.map(toComment);

	return {
		page: {
			sourceId: content.id,
			spaceKey: content.space?.key ?? "",
			parentSourceId: content.ancestors?.at(-1)?.id ?? null,
			position: 0,
			title: content.title ?? "",
			type: content.type === "blogpost" ? "blogpost" : "page",
			status:
				content.status === "trashed"
					? "trashed"
					: content.status === "draft"
						? "draft"
						: "current",
			versionNumber: content.version?.number ?? 1,
			storage: contentStorage(content),
			view: contentView(content),
			creatorUserKey: userRefKey(
				content.history?.createdBy ?? content.version?.by,
			),
			created: dateOf(content.history?.createdDate ?? content.version?.when),
			lastModifierUserKey: userRefKey(content.version?.by),
			updated: dateOf(content.version?.when),
			versions,
			comments: mappedComments,
			attachments,
			labels: (content.metadata?.labels?.results ?? [])
				.map((label) => label.name ?? "")
				.filter((name) => name !== ""),
			restrictions: restrictionsOf(content),
			watchers: social.watchers,
			likes: social.likes,
		},
		spaceWatchers: social.spaceWatchers,
		unexpectedKeys: social.unexpectedKeys,
	};
}

async function fetchSpace(
	client: ConfluenceClient,
	space: WikiSpace,
	options: WikiFetchOptions,
): Promise<
	WikiSpaceData & {
		skippedPermissions: Map<string, number>;
		socialShapeKeys: Set<string>;
	}
> {
	const permissions: WikiSpacePermission[] = [];
	const skippedPermissions = new Map<string, number>();
	for (const entry of await client.listSpacePermissions(space.key)) {
		const permission = toSpacePermission(entry);
		if (permission) {
			permissions.push(permission);
			continue;
		}
		const key = spacePermissionKey(
			entry.operation?.targetType,
			entry.operation?.operationKey,
		);
		skippedPermissions.set(key, (skippedPermissions.get(key) ?? 0) + 1);
	}

	const contents: ConfluenceContent[] = [];
	for (const type of ["page", "blogpost"] as const) {
		for (const status of ["current", "trashed", "draft"] as const) {
			const listed = await client.listContent(space.key, type, status);
			for (const content of listed) {
				contents.push({ ...content, type, status });
			}
		}
	}

	const pages: WikiPage[] = [];
	const spaceWatchers = new Map<string, WikiSocialUser>();
	const socialShapeKeys = new Set<string>();
	for (const content of contents) {
		try {
			const fetched = await fetchPage(client, content, options);
			pages.push(fetched.page);
			for (const key of fetched.unexpectedKeys) socialShapeKeys.add(key);
			for (const watcher of fetched.spaceWatchers) {
				const key = socialUserKey(watcher);
				if (key) spaceWatchers.set(key, watcher);
			}
		} catch (error) {
			throw pageError(content.id, error);
		}
	}

	await orderContent(client, space.key, pages);

	return {
		space,
		permissions,
		templates: [],
		pages,
		spaceWatchers: [...spaceWatchers.values()],
		skippedPermissions,
		socialShapeKeys,
	};
}

export async function fetchWikiDataset(
	client: ConfluenceClient,
	options: WikiFetchOptions,
): Promise<WikiFetchResult> {
	const users = await fetchUsers(client);

	const spaces: WikiSpace[] = [];
	for (const status of ["current", "archived"] as const) {
		const listed = await client.listSpaces(status);
		for (const space of listed) spaces.push(toSpace(space));
	}
	const seen = new Set<string>();
	const uniqueSpaces = spaces.filter((space) => {
		if (seen.has(space.key)) return false;
		seen.add(space.key);
		return true;
	});

	const wanted = options.spaceKeys;
	if (wanted && wanted.length > 0) {
		const missing = wanted.filter((key) => !seen.has(key));
		if (missing.length > 0) {
			throw new Error(`Unknown space keys: ${missing.join(", ")}`);
		}
	}

	const selected =
		wanted && wanted.length > 0
			? uniqueSpaces.filter((space) => wanted.includes(space.key))
			: uniqueSpaces;

	const macros = new Map<string, Set<string>>();
	const skippedPermissions = new Map<string, number>();
	const socialShapeKeys = new Set<string>();
	const data: WikiSpaceData[] = [];
	for (const space of selected) {
		const spaceData = await fetchSpace(client, space, options);
		for (const [key, count] of spaceData.skippedPermissions) {
			skippedPermissions.set(key, (skippedPermissions.get(key) ?? 0) + count);
		}
		for (const key of spaceData.socialShapeKeys) socialShapeKeys.add(key);
		for (const page of spaceData.pages) {
			for (const name of collectMacroNames(page.storage)) {
				const pages = macros.get(name);
				if (pages) pages.add(page.sourceId);
				else macros.set(name, new Set([page.sourceId]));
			}
		}
		data.push(spaceData);
	}

	if (socialShapeKeys.size > 0) {
		console.warn(
			`confluence watchers/likes: unexpected response shape; keys: ${[...socialShapeKeys].sort().join(", ")}`,
		);
	}

	return {
		spaces: data,
		users,
		macros,
		skippedPermissions,
		socialShapeKeys,
	};
}
