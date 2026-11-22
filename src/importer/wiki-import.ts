import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, like, sql } from "drizzle-orm";
import { users } from "../lib/server/schema.ts";
import {
	pageAttachments,
	pageComments,
	pageLabels,
	pageRestrictions,
	pages,
	pageTemplates,
	pageVersions,
	spacePermissions,
	spaces,
} from "../lib/server/schema-wiki.ts";
import {
	pageLikes,
	pageWatchers,
	spaceWatchers,
} from "../lib/server/schema-wiki-social.ts";
import { db } from "./db.ts";
import { deleteMissingRows } from "./import.ts";
import { type PrivateApiOptions, skipPrivateApi } from "./private-apis.ts";
import {
	type Executor,
	emptyCounts,
	type ImportCounts,
	mergeCounts,
	upsertRows,
} from "./upsert.ts";
import type { ExistingAttachment } from "./wiki-fetch.ts";
import {
	attachmentKey,
	rewriteStorageReferences,
	sanitizeWikiHtml,
	spaceTitleKey,
	type WikiLinkContext,
} from "./wiki-html.ts";
import { socialUserKey } from "./wiki-social.ts";
import type {
	WikiPage,
	WikiSocialUser,
	WikiSpaceData,
	WikiUser,
} from "./wiki-types.ts";

export interface WikiImportOptions extends PrivateApiOptions {
	baseUrl: string;
	/** Drop a space's pages from the dataset once imported, so their bodies can be freed. */
	releaseSpaces?: boolean;
	/** Deliberate reset: overwrite pages changed locally and clear their marker. */
	overwriteLocal?: boolean;
}

export interface WikiImportResult {
	counts: ImportCounts;
	social: WikiSocialStats;
	/** Page ids kept because they were changed locally. */
	localChanges: Record<string, string[]>;
}

export interface WikiSocialStats {
	unknownPageWatchers: number;
	unknownSpaceWatchers: number;
	unknownLikes: number;
}

interface IdMaps {
	pageIds: Map<string, string>;
	commentIds: Map<string, string>;
	attachmentIds: Map<string, string>;
	userIdsByUsername: Map<string, string>;
	userIdsByUserKey: Map<string, string>;
}

interface RenderedBody {
	bodyStorage: string | null;
	bodyHtml: string | null;
	versionNumber: number | null;
	renderedContext: string | null;
}

function dedupe<T>(values: T[], key: (value: T) => string) {
	const map = new Map<string, T>();
	for (const value of values) map.set(key(value), value);
	return [...map.values()];
}

function collectUsers(dataset: WikiSpaceData[]): WikiUser[] {
	const collected = new Map<string, WikiUser>();
	for (const space of dataset) {
		for (const page of space.pages) {
			for (const user of [
				page.creatorUserKey,
				page.lastModifierUserKey,
				...page.versions.map((version) => version.authorUserKey),
				...page.comments.map((comment) => comment.authorUserKey),
				...page.attachments.map((attachment) => attachment.authorUserKey),
				...page.restrictions.map((restriction) => restriction.userKey),
			]) {
				if (user && !collected.has(user)) {
					collected.set(user, {
						userKey: user,
						username: user,
						displayName: user,
						email: null,
						avatarUrl: null,
						active: true,
					});
				}
			}
		}
	}
	return [...collected.values()];
}

async function importUsers(
	tx: Executor,
	directory: WikiUser[],
	referenced: WikiUser[],
) {
	const counts = emptyCounts();
	const input = dedupe(
		[...directory, ...referenced].filter((user) => user.username !== ""),
		(user) => user.username,
	);
	const directoryNames = new Set(directory.map((user) => user.username));
	const existing = await tx.select().from(users);
	const bySourceKey = new Map<string, (typeof existing)[number]>();
	const byUsername = new Map<string, (typeof existing)[number]>();
	for (const row of existing) {
		if (row.sourceKey) bySourceKey.set(row.sourceKey, row);
		byUsername.set(row.username, row);
	}

	const inserts: (typeof users.$inferInsert)[] = [];
	const idsByUsername = new Map<string, string>();
	const idsByUserKey = new Map<string, string>();
	for (const user of input) {
		const current =
			(user.userKey ? bySourceKey.get(user.userKey) : undefined) ??
			byUsername.get(user.username);

		const placeholder = !directoryNames.has(user.username);
		const values = {
			sourceKey: current?.sourceKey ?? user.userKey,
			username: user.username,
			email: user.email ?? current?.email ?? null,
			displayName: user.displayName || current?.displayName || user.username,
			avatarUrl: user.avatarUrl ?? current?.avatarUrl ?? null,
			active: placeholder ? false : user.active,
		};

		if (!current) {
			inserts.push(values);
			continue;
		}

		idsByUsername.set(user.username, current.id);
		if (user.userKey) idsByUserKey.set(user.userKey, current.id);
		if (placeholder) {
			counts.unchanged++;
			continue;
		}
		const changed = (
			[
				"sourceKey",
				"username",
				"email",
				"displayName",
				"avatarUrl",
				"active",
			] as const
		).some((key) => current[key] !== values[key]);
		if (!changed) {
			counts.unchanged++;
			continue;
		}

		await tx
			.update(users)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(users.id, current.id));
		counts.updated++;
	}

	if (inserts.length > 0) {
		for (let index = 0; index < inserts.length; index += 100) {
			const chunk = inserts.slice(index, index + 100);
			const returned = await tx
				.insert(users)
				.values(chunk)
				.returning({ id: users.id, username: users.username });
			for (const row of returned) {
				idsByUsername.set(row.username, row.id);
				const sourceKey = chunk.find(
					(value) => value.username === row.username,
				)?.sourceKey;
				if (sourceKey) idsByUserKey.set(sourceKey, row.id);
			}
			counts.inserted += chunk.length;
		}
	}

	return { counts, idsByUsername, idsByUserKey };
}

async function existingIds(
	tx: Executor,
	table: typeof pages | typeof pageComments | typeof pageAttachments,
): Promise<Map<string, string>> {
	const rows = (await tx
		.select({ id: table.id, sourceId: table.sourceId })
		.from(table)) as { id: string; sourceId: string }[];
	return new Map(rows.map((row) => [row.sourceId, row.id]));
}

/** The stored renderings of one space's pages, versions and comments. */
async function renderedBodies(
	tx: Executor,
	spaceSourceId: string,
): Promise<Map<string, RenderedBody>> {
	const stored = new Map<string, RenderedBody>();
	const inSpace = eq(spaces.sourceId, spaceSourceId);
	const pageRows = await tx
		.select({
			sourceId: pages.sourceId,
			bodyStorage: pages.bodyStorage,
			bodyHtml: pages.bodyHtml,
			versionNumber: pages.versionNumber,
			renderedContext: pages.renderedContext,
		})
		.from(pages)
		.innerJoin(spaces, eq(spaces.id, pages.spaceId))
		.where(inSpace);
	for (const row of pageRows) {
		stored.set(`page:${row.sourceId}`, {
			bodyStorage: row.bodyStorage,
			bodyHtml: row.bodyHtml,
			versionNumber: row.versionNumber,
			renderedContext: row.renderedContext,
		});
	}
	const versionRows = await tx
		.select({
			sourceId: pageVersions.sourceId,
			bodyStorage: pageVersions.bodyStorage,
			bodyHtml: pageVersions.bodyHtml,
			renderedContext: pageVersions.renderedContext,
		})
		.from(pageVersions)
		.innerJoin(pages, eq(pages.id, pageVersions.pageId))
		.innerJoin(spaces, eq(spaces.id, pages.spaceId))
		.where(inSpace);
	for (const row of versionRows) {
		stored.set(`version:${row.sourceId}`, {
			bodyStorage: row.bodyStorage,
			bodyHtml: row.bodyHtml,
			versionNumber: null,
			renderedContext: row.renderedContext,
		});
	}
	const commentRows = await tx
		.select({
			sourceId: pageComments.sourceId,
			bodyStorage: pageComments.bodyStorage,
			bodyHtml: pageComments.bodyHtml,
			renderedContext: pageComments.renderedContext,
		})
		.from(pageComments)
		.innerJoin(pages, eq(pages.id, pageComments.pageId))
		.innerJoin(spaces, eq(spaces.id, pages.spaceId))
		.where(inSpace);
	for (const row of commentRows) {
		stored.set(`comment:${row.sourceId}`, {
			bodyStorage: row.bodyStorage,
			bodyHtml: row.bodyHtml,
			versionNumber: null,
			renderedContext: row.renderedContext,
		});
	}
	return stored;
}

function pageDepth(page: WikiPage, bySource: Map<string, WikiPage>): number {
	let depth = 0;
	let current = page.parentSourceId;
	const seen = new Set<string>();
	while (current) {
		if (seen.has(current)) break;
		seen.add(current);
		depth++;
		current = bySource.get(current)?.parentSourceId ?? null;
	}
	return depth;
}

function latestAttachmentIds(
	dataset: WikiSpaceData[],
	maps: IdMaps,
): Map<string, string> {
	const latest = new Map<
		string,
		{ sourceId: string; version: number; page: string; fileName: string }
	>();
	for (const space of dataset) {
		for (const page of space.pages) {
			for (const attachment of page.attachments) {
				const key = attachmentKey(page.sourceId, attachment.fileName);
				const current = latest.get(key);
				if (!current || attachment.version > current.version) {
					latest.set(key, {
						sourceId: attachment.sourceId,
						version: attachment.version,
						page: page.sourceId,
						fileName: attachment.fileName,
					});
				}
			}
		}
	}
	const ids = new Map<string, string>();
	for (const [key, entry] of latest) {
		const id = maps.attachmentIds.get(entry.sourceId);
		if (id) ids.set(key, id);
	}
	return ids;
}

async function buildLinkContext(
	dataset: WikiSpaceData[],
	users: WikiUser[],
	maps: IdMaps,
): Promise<WikiLinkContext> {
	const pageIds = new Set<string>();
	const pageIdsBySpaceTitle = new Map<string, string>();
	const storedPages = await db
		.select({
			sourceId: pages.sourceId,
			title: pages.title,
			status: pages.status,
			spaceKey: spaces.key,
		})
		.from(pages)
		.innerJoin(spaces, eq(pages.spaceId, spaces.id));
	for (const page of storedPages) {
		pageIds.add(page.sourceId);
		if (page.status === "current" && page.title) {
			pageIdsBySpaceTitle.set(
				spaceTitleKey(page.spaceKey, page.title),
				page.sourceId,
			);
		}
	}
	for (const space of dataset) {
		for (const page of space.pages) {
			pageIds.add(page.sourceId);
			if (page.status === "current" && page.title) {
				pageIdsBySpaceTitle.set(
					spaceTitleKey(space.space.key, page.title),
					page.sourceId,
				);
			}
		}
	}
	const attachmentIds = new Map<string, string>();
	const storedAttachments = await db
		.select({
			sourceId: pageAttachments.sourceId,
			pageSourceId: pages.sourceId,
			fileName: pageAttachments.fileName,
			version: pageAttachments.version,
		})
		.from(pageAttachments)
		.innerJoin(pages, eq(pageAttachments.pageId, pages.id));
	const latest = new Map<string, { sourceId: string; version: number }>();
	for (const attachment of storedAttachments) {
		const key = attachmentKey(attachment.pageSourceId, attachment.fileName);
		const current = latest.get(key);
		if (!current || attachment.version > current.version) {
			latest.set(key, {
				sourceId: attachment.sourceId,
				version: attachment.version,
			});
		}
	}
	for (const [key, attachment] of latest) {
		const id = maps.attachmentIds.get(attachment.sourceId);
		if (id) attachmentIds.set(key, id);
	}
	for (const [key, id] of latestAttachmentIds(dataset, maps)) {
		attachmentIds.set(key, id);
	}
	const userNamesByUserKey = new Map<string, string>();
	for (const user of users) {
		if (user.userKey) userNamesByUserKey.set(user.userKey, user.displayName);
	}
	return {
		pageIds,
		pageIdsBySpaceTitle,
		attachmentIds,
		userIdsByUsername: maps.userIdsByUsername,
		userIdsByUserKey: maps.userIdsByUserKey,
		userNamesByUserKey,
	};
}

function linkContextKey(ctx: WikiLinkContext): string {
	const sorted = (entries: Iterable<[string, string]>) =>
		[...entries].sort(([left], [right]) => left.localeCompare(right));
	const payload = JSON.stringify({
		pageIds: [...ctx.pageIds].sort(),
		pages: sorted(ctx.pageIdsBySpaceTitle),
		attachments: sorted(ctx.attachmentIds),
		usernames: sorted(ctx.userIdsByUsername),
		userKeys: sorted(ctx.userIdsByUserKey),
		userNames: sorted(ctx.userNamesByUserKey),
	});
	return createHash("sha256").update(payload).digest("hex");
}

function renderBody(
	pageId: string,
	ctx: WikiLinkContext,
	baseUrl: string,
	storage: string,
	view: string,
): string | null {
	const rendered = sanitizeWikiHtml(view, ctx, baseUrl);
	if (rendered) return rendered;
	if (!storage) return null;
	return sanitizeWikiHtml(
		rewriteStorageReferences(storage, ctx, pageId),
		ctx,
		baseUrl,
	);
}

function socialSourceId(
	kind: "page-watcher" | "space-watcher" | "page-like",
	parentSourceId: string,
	user: WikiSocialUser,
): string {
	return `confluence:${kind}:${parentSourceId}:${socialUserKey(user)}`;
}

async function importSocialRows(
	tx: Executor,
	table: typeof pageWatchers | typeof spaceWatchers | typeof pageLikes,
	parentColumn:
		| typeof pageWatchers.pageId
		| typeof spaceWatchers.spaceId
		| typeof pageLikes.pageId,
	parentField: "pageId" | "spaceId",
	parentId: string,
	parentSourceId: string,
	users: WikiSocialUser[],
	maps: IdMaps,
	counts: ImportCounts,
	social: WikiSocialStats,
	kind: "page-watcher" | "space-watcher" | "page-like",
	tableKey: "page_watchers" | "space_watchers" | "page_likes",
) {
	const resolved = new Map<string, { userId: string; sourceId: string }>();
	let unknown = 0;
	for (const user of users) {
		const userId =
			(user.userKey ? maps.userIdsByUserKey.get(user.userKey) : undefined) ??
			(user.username ? maps.userIdsByUsername.get(user.username) : undefined) ??
			null;
		if (!userId) {
			unknown++;
			continue;
		}
		if (!resolved.has(userId)) {
			resolved.set(userId, {
				userId,
				sourceId: socialSourceId(kind, parentSourceId, user),
			});
		}
	}
	if (kind === "page-watcher") social.unknownPageWatchers += unknown;
	else if (kind === "space-watcher") social.unknownSpaceWatchers += unknown;
	else social.unknownLikes += unknown;

	const existing = (await tx
		.select({
			id: table.id,
			sourceId: table.sourceId,
			userId: table.userId,
		})
		.from(table)
		.where(eq(parentColumn, parentId))) as {
		id: string;
		sourceId: string | null;
		userId: string;
	}[];
	const byUser = new Map(existing.map((row) => [row.userId, row]));
	const rows: Record<string, unknown>[] = [];
	let unchanged = 0;
	for (const candidate of resolved.values()) {
		const current = byUser.get(candidate.userId);
		// A row without a source id was added in the application; leave it alone.
		if (current && current.sourceId === null) {
			unchanged++;
			continue;
		}
		rows.push({
			sourceId: candidate.sourceId,
			[parentField]: parentId,
			userId: candidate.userId,
		});
	}
	const result = await upsertRows(tx, table, rows, (row) =>
		String(row.sourceId),
	);
	mergeCounts(counts, tableKey, {
		inserted: result.counts.inserted,
		updated: result.counts.updated,
		unchanged: result.counts.unchanged + unchanged,
	});
	await deleteMissingRows(
		tx,
		table,
		table.sourceId,
		parentColumn,
		parentId,
		[...resolved.values()].map((candidate) => candidate.sourceId),
		{
			importedOnly: true,
			sourceIdColumn: table.sourceId,
			sourceIdPrefix: `confluence:${kind}:${parentSourceId}:`,
		},
	);
}

async function importSpace(
	tx: Executor,
	data: WikiSpaceData,
	maps: IdMaps,
	ctx: WikiLinkContext,
	contextKey: string,
	options: WikiImportOptions,
	counts: ImportCounts,
	social: WikiSocialStats,
	localChanges: Record<string, string[]>,
) {
	const stored = await renderedBodies(tx, data.space.sourceId);
	const socialSkipped = skipPrivateApi(options, "page watchers and likes");
	const renderedBody = (
		kind: "page" | "version" | "comment",
		sourceId: string,
		versionNumber: number | null,
		storage: string,
		view: string,
		pageSourceId: string,
	) => {
		const existing = stored.get(`${kind}:${sourceId}`);
		const storedStorage = storage || null;
		if (
			existing &&
			existing.bodyHtml !== null &&
			existing.bodyStorage === storedStorage &&
			existing.versionNumber === versionNumber &&
			existing.renderedContext === contextKey
		) {
			return existing.bodyHtml;
		}
		return renderBody(pageSourceId, ctx, options.baseUrl, storage, view);
	};
	const userId = (key: string | null) =>
		key
			? (maps.userIdsByUserKey.get(key) ??
				maps.userIdsByUsername.get(key) ??
				null)
			: null;

	const bySource = new Map(data.pages.map((page) => [page.sourceId, page]));

	const spaceResult = await upsertRows(
		tx,
		spaces,
		[
			{
				sourceId: data.space.sourceId,
				key: data.space.key,
				name: data.space.name,
				type: data.space.type,
				descriptionHtml: data.space.descriptionHtml,
				ownerId:
					data.space.type === "personal"
						? userId(data.space.creatorUserKey)
						: null,
				status: data.space.status,
				iconPath: data.space.iconPath,
				created: data.space.created,
				creatorId: userId(data.space.creatorUserKey),
			},
		],
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "spaces", spaceResult.counts);
	const spaceId = spaceResult.ids.get(data.space.sourceId);
	if (!spaceId) throw new Error(`space ${data.space.key} was not imported`);

	if (!socialSkipped && !data.socialShapeMismatch) {
		await importSocialRows(
			tx,
			spaceWatchers,
			spaceWatchers.spaceId,
			"spaceId",
			spaceId,
			data.space.sourceId,
			data.spaceWatchers,
			maps,
			counts,
			social,
			"space-watcher",
			"space_watchers",
		);
	}

	const orderedPages = [...data.pages].sort(
		(left, right) =>
			pageDepth(left, bySource) - pageDepth(right, bySource) ||
			left.sourceId.localeCompare(right.sourceId),
	);

	const pageSourceIds = data.pages.map((page) => page.sourceId);
	const locallyChangedPages = new Map<string, string>();
	if (!options.overwriteLocal && pageSourceIds.length > 0) {
		const marked = await tx
			.select({ id: pages.id, sourceId: pages.sourceId })
			.from(pages)
			.where(
				and(
					inArray(pages.sourceId, pageSourceIds),
					isNotNull(pages.locallyChangedAt),
				),
			);
		for (const row of marked) locallyChangedPages.set(row.sourceId, row.id);
		const localVersions = await tx
			.select({ id: pages.id, sourceId: pages.sourceId })
			.from(pageVersions)
			.innerJoin(pages, eq(pages.id, pageVersions.pageId))
			.where(
				and(
					inArray(pages.sourceId, pageSourceIds),
					like(pageVersions.sourceId, "fat:%"),
				),
			);
		for (const row of localVersions)
			locallyChangedPages.set(row.sourceId, row.id);
	}
	for (const id of locallyChangedPages.values()) {
		localChanges.pages ??= [];
		if (!localChanges.pages.includes(id)) localChanges.pages.push(id);
	}

	await upsertRows(
		tx,
		pages,
		dedupe(
			orderedPages
				.filter((page) => !locallyChangedPages.has(page.sourceId))
				.map((page) => {
					const parentId = page.parentSourceId
						? (maps.pageIds.get(page.parentSourceId) ?? null)
						: null;
					return {
						id: maps.pageIds.get(page.sourceId),
						sourceId: page.sourceId,
						spaceId,
						parentId,
						position: page.position,
						title: page.title,
						type: page.type,
						status: page.status,
						versionNumber: page.versionNumber,
						bodyStorage: page.storage || null,
						bodyHtml: renderedBody(
							"page",
							page.sourceId,
							page.versionNumber,
							page.storage,
							page.view,
							page.sourceId,
						),
						renderedContext: contextKey,
						creatorId: userId(page.creatorUserKey),
						created: page.created,
						lastModifierId: userId(page.lastModifierUserKey),
						updated: page.updated,
					};
				}),
			(row) => String(row.sourceId),
		),
		(row) => String(row.sourceId),
		{
			keyColumn: pages.sourceId,
			localChangeColumn: pages.locallyChangedAt,
			overwriteLocal: options.overwriteLocal,
		},
	).then((result) => {
		mergeCounts(counts, "pages", result.counts);
		for (const id of result.keptLocalIds) {
			localChanges.pages ??= [];
			if (!localChanges.pages.includes(id)) localChanges.pages.push(id);
		}
	});

	for (const page of data.pages) {
		const pageId = maps.pageIds.get(page.sourceId);
		if (!pageId) throw new Error(`page ${page.sourceId} was not imported`);
		if (!socialSkipped && !page.socialShapeMismatch) {
			await importSocialRows(
				tx,
				pageWatchers,
				pageWatchers.pageId,
				"pageId",
				pageId,
				page.sourceId,
				page.watchers,
				maps,
				counts,
				social,
				"page-watcher",
				"page_watchers",
			);
			await importSocialRows(
				tx,
				pageLikes,
				pageLikes.pageId,
				"pageId",
				pageId,
				page.sourceId,
				page.likes,
				maps,
				counts,
				social,
				"page-like",
				"page_likes",
			);
		}
	}

	if (data.space.homePageSourceId) {
		const homePageId = maps.pageIds.get(data.space.homePageSourceId);
		if (homePageId) {
			const current = await tx
				.select({ homePageId: spaces.homePageId })
				.from(spaces)
				.where(eq(spaces.id, spaceId));
			if (current[0]?.homePageId !== homePageId) {
				await tx
					.update(spaces)
					.set({ homePageId, updatedAt: new Date() })
					.where(eq(spaces.id, spaceId));
				counts.spaces = counts.spaces ?? emptyCounts();
				counts.spaces.updated++;
			}
		}
	}

	const existingVersions = pageSourceIds.length
		? await tx
				.select({
					sourceId: pageVersions.sourceId,
					number: pageVersions.number,
					pageId: pageVersions.pageId,
				})
				.from(pageVersions)
				.innerJoin(pages, eq(pages.id, pageVersions.pageId))
				.where(inArray(pages.sourceId, pageSourceIds))
		: [];
	const existingVersionSourceIds = new Set(
		existingVersions.map((row) => row.sourceId),
	);
	const existingVersionNumbers = new Set(
		existingVersions.map((row) => `${row.pageId}:${row.number}`),
	);
	const versionRows = data.pages.flatMap((page) => {
		const pageId = maps.pageIds.get(page.sourceId) ?? "";
		const kept = locallyChangedPages.has(page.sourceId);
		return page.versions
			.filter(
				(version) =>
					!kept ||
					(!existingVersionSourceIds.has(
						`${page.sourceId}@${version.number}`,
					) &&
						!existingVersionNumbers.has(`${pageId}:${version.number}`)),
			)
			.map((version) => ({
				sourceId: `${page.sourceId}@${version.number}`,
				pageId: maps.pageIds.get(page.sourceId),
				number: version.number,
				title: version.title,
				bodyStorage: version.storage || null,
				bodyHtml: renderedBody(
					"version",
					`${page.sourceId}@${version.number}`,
					null,
					version.storage,
					version.view,
					page.sourceId,
				),
				renderedContext: contextKey,
				authorId: userId(version.authorUserKey),
				created: version.created,
				message: version.message,
				minorEdit: version.minorEdit,
			}));
	});
	await upsertRows(
		tx,
		pageVersions,
		dedupe(versionRows, (row) => String(row.sourceId)),
		(row) => String(row.sourceId),
		{
			keyColumn: pageVersions.sourceId,
			localChangeColumn: pageVersions.locallyChangedAt,
			overwriteLocal: options.overwriteLocal,
			onConflictDoNothing: true,
		},
	).then((result) => mergeCounts(counts, "page_versions", result.counts));

	const commentParents = new Map<string, string | null>();
	for (const page of data.pages) {
		for (const comment of page.comments) {
			commentParents.set(comment.sourceId, comment.parentSourceId);
		}
	}
	const commentDepth = (sourceId: string) => {
		let depth = 0;
		let current = commentParents.get(sourceId) ?? null;
		const seen = new Set<string>();
		while (current && !seen.has(current)) {
			seen.add(current);
			depth++;
			current = commentParents.get(current) ?? null;
		}
		return depth;
	};

	const commentRows = data.pages.flatMap((page) =>
		[...page.comments]
			.sort(
				(left, right) =>
					commentDepth(left.sourceId) - commentDepth(right.sourceId) ||
					left.sourceId.localeCompare(right.sourceId),
			)
			.map((comment) => ({
				id: maps.commentIds.get(comment.sourceId),
				sourceId: comment.sourceId,
				pageId: maps.pageIds.get(page.sourceId),
				parentId: comment.parentSourceId
					? (maps.commentIds.get(comment.parentSourceId) ?? null)
					: null,
				authorId: userId(comment.authorUserKey),
				bodyHtml: renderedBody(
					"comment",
					comment.sourceId,
					null,
					comment.storage,
					comment.view,
					page.sourceId,
				),
				bodyStorage: comment.storage || null,
				renderedContext: contextKey,
				created: comment.created,
				updated: comment.updated,
				inline: comment.inline,
				inlineOriginalSelection: comment.inlineOriginalSelection,
				inlineMarkerRef: comment.inlineMarkerRef,
				resolved: comment.resolved,
			})),
	);
	await upsertRows(
		tx,
		pageComments,
		dedupe(commentRows, (row) => String(row.sourceId)),
		(row) => String(row.sourceId),
		{
			keyColumn: pageComments.sourceId,
			localChangeColumn: pageComments.locallyChangedAt,
			overwriteLocal: options.overwriteLocal,
		},
	).then((result) => mergeCounts(counts, "page_comments", result.counts));

	const attachmentRows = data.pages.flatMap((page) =>
		page.attachments.map((attachment) => ({
			id: maps.attachmentIds.get(attachment.sourceId),
			sourceId: attachment.sourceId,
			pageId: maps.pageIds.get(page.sourceId),
			fileName: attachment.fileName,
			mimeType: attachment.mimeType,
			size: attachment.size,
			version: attachment.version,
			authorId: userId(attachment.authorUserKey),
			created: attachment.created,
			comment: attachment.comment,
			storagePath: attachment.storagePath,
			sha256: attachment.sha256,
		})),
	);
	await upsertRows(
		tx,
		pageAttachments,
		dedupe(attachmentRows, (row) => String(row.sourceId)),
		(row) => String(row.sourceId),
	).then((result) => mergeCounts(counts, "page_attachments", result.counts));

	const labelRows = data.pages.flatMap((page) =>
		(locallyChangedPages.has(page.sourceId) ? [] : page.labels).map(
			(label) => ({
				sourceId: `${page.sourceId}#label:${label}`,
				pageId: maps.pageIds.get(page.sourceId),
				label,
			}),
		),
	);
	await upsertRows(
		tx,
		pageLabels,
		dedupe(labelRows, (row) => String(row.sourceId)),
		(row) => String(row.sourceId),
	).then((result) => mergeCounts(counts, "page_labels", result.counts));

	const restrictionRows = data.pages.flatMap((page) =>
		(locallyChangedPages.has(page.sourceId) ? [] : page.restrictions).map(
			(restriction) => {
				const subject = restriction.userKey
					? `user:${restriction.userKey}`
					: `group:${restriction.groupName}`;
				return {
					sourceId: `${page.sourceId}#restriction:${restriction.operation}:${subject}`,
					pageId: maps.pageIds.get(page.sourceId),
					operation: restriction.operation,
					userId: userId(restriction.userKey),
					groupName: restriction.groupName,
				};
			},
		),
	);
	await upsertRows(
		tx,
		pageRestrictions,
		dedupe(restrictionRows, (row) => String(row.sourceId)),
		(row) => String(row.sourceId),
	).then((result) => mergeCounts(counts, "page_restrictions", result.counts));

	const permissionRows = data.permissions.map((permission) => {
		const subject = permission.anonymous
			? "anonymous"
			: permission.userKey
				? `user:${permission.userKey}`
				: `group:${permission.groupName}`;
		return {
			sourceId: `${data.space.key}#permission:${permission.permission}:${subject}`,
			spaceId,
			permission: permission.permission,
			userId: userId(permission.userKey),
			groupName: permission.groupName,
			anonymous: permission.anonymous,
		};
	});
	// An empty answer would remove every imported grant and lock the space,
	// so it removes nothing; a real "no grants" space has no rows to remove.
	if (permissionRows.length === 0) {
		console.warn(
			`space ${data.space.key}: Confluence returned no importable permission; imported permission rows are kept`,
		);
	} else {
		await deleteMissingRows(
			tx,
			spacePermissions,
			spacePermissions.sourceId,
			spacePermissions.spaceId,
			spaceId,
			permissionRows.map((row) => String(row.sourceId)),
			{
				importedOnly: true,
				sourceIdColumn: spacePermissions.sourceId,
				sourceIdPrefix: `${data.space.key}#permission:`,
			},
		);
	}
	await upsertRows(
		tx,
		spacePermissions,
		dedupe(permissionRows, (row) => String(row.sourceId)),
		(row) => String(row.sourceId),
	).then((result) => mergeCounts(counts, "space_permissions", result.counts));

	const templateRows = data.templates.map((template) => ({
		sourceId: template.sourceId,
		spaceId,
		name: template.name,
		description: template.description,
		bodyStorage: template.bodyStorage,
	}));
	await upsertRows(
		tx,
		pageTemplates,
		dedupe(templateRows, (row) => String(row.sourceId)),
		(row) => String(row.sourceId),
	).then((result) => mergeCounts(counts, "page_templates", result.counts));
}

export async function loadWikiAttachmentIndex(): Promise<
	Map<string, ExistingAttachment>
> {
	const rows = await db
		.select({
			sourceId: pageAttachments.sourceId,
			storagePath: pageAttachments.storagePath,
			sha256: pageAttachments.sha256,
			size: pageAttachments.size,
		})
		.from(pageAttachments);
	return new Map(
		rows.map((row) => [
			row.sourceId,
			{ storagePath: row.storagePath, sha256: row.sha256, size: row.size },
		]),
	);
}

export async function importWikiDataset(
	dataset: { spaces: WikiSpaceData[]; users: WikiUser[] },
	options: WikiImportOptions,
): Promise<WikiImportResult> {
	const counts: ImportCounts = {};
	const social: WikiSocialStats = {
		unknownPageWatchers: 0,
		unknownSpaceWatchers: 0,
		unknownLikes: 0,
	};

	const localChanges: Record<string, string[]> = {};
	const userMaps = await db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('rvna.importer', 'on', true)`);
		const directoryKeys = new Set(
			dataset.users.map((user) => user.userKey).filter((key) => key !== null),
		);
		const referenced = collectUsers(dataset.spaces).filter(
			(user) => !user.userKey || !directoryKeys.has(user.userKey),
		);
		const result = await importUsers(tx as Executor, dataset.users, referenced);
		mergeCounts(counts, "users", result.counts);
		return result;
	});

	const pageIds = await existingIds(db, pages);
	const commentIds = await existingIds(db, pageComments);
	const attachmentIds = await existingIds(db, pageAttachments);
	for (const space of dataset.spaces) {
		for (const page of space.pages) {
			if (!pageIds.has(page.sourceId)) pageIds.set(page.sourceId, randomUUID());
			for (const comment of page.comments) {
				if (!commentIds.has(comment.sourceId)) {
					commentIds.set(comment.sourceId, randomUUID());
				}
			}
			for (const attachment of page.attachments) {
				if (!attachmentIds.has(attachment.sourceId)) {
					attachmentIds.set(attachment.sourceId, randomUUID());
				}
			}
		}
	}

	const maps: IdMaps = {
		pageIds,
		commentIds,
		attachmentIds,
		userIdsByUsername: userMaps.idsByUsername,
		userIdsByUserKey: userMaps.idsByUserKey,
	};

	const ctx = await buildLinkContext(dataset.spaces, dataset.users, maps);
	const contextKey = linkContextKey(ctx);
	for (const space of dataset.spaces) {
		try {
			await db.transaction(async (tx) => {
				await tx.execute(sql`select set_config('rvna.importer', 'on', true)`);
				return importSpace(
					tx as Executor,
					space,
					maps,
					ctx,
					contextKey,
					options,
					counts,
					social,
					localChanges,
				);
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`space ${space.space.key}: ${message}`);
		}
		if (options.releaseSpaces) space.pages = [];
	}

	return { counts, social, localChanges };
}
