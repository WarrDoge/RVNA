import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../admin/audit.ts";
import {
	attachmentUploadLimits,
	contentDisposition,
	hashFile,
	MAX_UPLOAD_FILES,
} from "../attachments/service.ts";
import type { CurrentUser } from "../auth.ts";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { sanitizeBodyHtml } from "../html.ts";
import { HttpError } from "../http.ts";
import {
	pageAttachments,
	pageComments,
	pageLabels,
	pageLikes,
	pageRestrictions,
	pages,
	pageTemplates,
	pageWatchers,
	spacePermissions,
	spaces,
	spaceWatchers,
	users,
} from "../schema.ts";
import { tooManyFiles, type UploadedForm } from "../uploads.ts";
import { pageAccess } from "../wiki-edit/access.ts";
import { removeOrphanFiles } from "../wiki-edit/files.ts";
import { assertNotLockedByOthers } from "../wiki-edit/locks.ts";
import { pageAttachmentVersions, recentPageLinks } from "./data.ts";
import { diffHtml } from "./diff.ts";
import {
	childPages,
	commentById,
	findPageByTitle,
	loadPageRow,
	loadReadablePage,
	loadSpaceRow,
	type PageRow,
	pageAncestors,
	pageAttachmentById,
	pageAttachmentByName,
	pageCommentRows,
	pageCount,
	pageLabelsFor,
	pageVersion,
	pageVersionsFor,
	type SpaceRow,
	spaceTreeRoots,
} from "./pages.ts";
import {
	canManageComment,
	loadWikiAccess,
	pageReadable,
	type WikiAccess,
} from "./permissions.ts";
import { type RenderScope, renderWikiBody } from "./render.ts";
import type {
	CreateCommentInput,
	ResolveInput,
	SearchInput,
} from "./schemas.ts";
import {
	excerpt as searchExcerpt,
	searchWikiPages,
	suggestWikiPages,
} from "./search.ts";
import { sanitizeWikiBody } from "./storage.ts";

export { contentDisposition };

const iso = (value: Date | null) => value?.toISOString() ?? null;

function userRef(row: {
	id: string | null;
	username: string | null;
	displayName: string | null;
	avatarUrl: string | null;
}) {
	if (!row.id || !row.username || !row.displayName) return null;
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		avatarUrl: row.avatarUrl,
	};
}

function spaceSummary(
	row: SpaceRow,
	homePage: { id: string; sourceId: string; title: string } | null,
	count: number,
) {
	const description = row.descriptionHtml
		? sanitizeWikiBody(row.descriptionHtml)
		: null;
	return {
		id: row.id,
		key: row.key,
		name: row.name,
		type: row.type,
		descriptionHtml: description || null,
		iconPath: row.iconPath,
		homePage,
		pageCount: count,
		created: iso(row.created),
	};
}

async function homePageOf(space: SpaceRow, access: WikiAccess) {
	if (!space.homePageId) return null;
	const [row] = await db
		.select({
			id: pages.id,
			sourceId: pages.sourceId,
			title: pages.title,
			spaceId: pages.spaceId,
		})
		.from(pages)
		.where(and(eq(pages.id, space.homePageId), eq(pages.spaceId, space.id)))
		.limit(1);
	if (!row || !pageReadable(access, row)) return null;
	return { id: row.id, sourceId: row.sourceId, title: row.title };
}

/** Summaries for the readable rows, with their home pages and counts in two batch queries. */
async function spaceSummaries(access: WikiAccess, rows: SpaceRow[]) {
	const readable = rows.filter((row) => access.readableSpaceIds.has(row.id));
	if (readable.length === 0) return [];
	const homePageIds = readable
		.map((row) => row.homePageId)
		.filter((id): id is string => id !== null);
	const countFilters = [
		inArray(
			pages.spaceId,
			readable.map((row) => row.id),
		),
		eq(pages.status, "current"),
	];
	if (access.hiddenPageIds.size > 0) {
		countFilters.push(notInArray(pages.id, [...access.hiddenPageIds]));
	}
	const [homeRows, countRows] = await Promise.all([
		homePageIds.length > 0
			? db
					.select({
						id: pages.id,
						sourceId: pages.sourceId,
						title: pages.title,
						spaceId: pages.spaceId,
					})
					.from(pages)
					.where(inArray(pages.id, homePageIds))
			: [],
		db
			.select({ spaceId: pages.spaceId, count: sql<number>`count(*)::int` })
			.from(pages)
			.where(and(...countFilters))
			.groupBy(pages.spaceId),
	]);
	const homes = new Map(homeRows.map((row) => [row.id, row]));
	const counts = new Map(countRows.map((row) => [row.spaceId, row.count]));
	return readable.map((row) => {
		const home = row.homePageId ? homes.get(row.homePageId) : undefined;
		return spaceSummary(
			row,
			home && home.spaceId === row.id && pageReadable(access, home)
				? { id: home.id, sourceId: home.sourceId, title: home.title }
				: null,
			counts.get(row.id) ?? 0,
		);
	});
}

function scopeFor(
	user: CurrentUser,
	access: WikiAccess,
	space: SpaceRow,
): RenderScope {
	return { user, access, space, searchUser: user };
}

async function renderPage(
	page: PageRow,
	scope: RenderScope,
): Promise<string | null> {
	return renderWikiBody(
		{
			id: page.id,
			sourceId: page.sourceId,
			spaceId: page.spaceId,
			title: page.title,
			bodyStorage: page.bodyStorage,
			bodyHtml: page.bodyHtml,
		},
		scope,
	);
}

async function commentView(
	row: Awaited<ReturnType<typeof pageCommentRows>>[number],
	user: CurrentUser,
) {
	return {
		id: row.id,
		parentId: row.parentId,
		author: userRef({
			id: row.authorId,
			username: row.authorUsername,
			displayName: row.authorDisplayName,
			avatarUrl: row.authorAvatarUrl,
		}),
		bodyHtml: row.bodyHtml === null ? null : sanitizeWikiBody(row.bodyHtml),
		created: iso(row.created),
		updated: iso(row.updated),
		inline: row.inline,
		inlineMarkerRef: row.inlineMarkerRef,
		inlineSelection: row.inlineOriginalSelection,
		resolved: row.resolved,
		canEdit: canManageComment(user, { authorId: row.authorId }),
	};
}

async function watchState(pageId: string, userId: string) {
	const [watchers, mine] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(pageWatchers)
			.where(eq(pageWatchers.pageId, pageId)),
		db
			.select({ id: pageWatchers.id })
			.from(pageWatchers)
			.where(
				and(eq(pageWatchers.pageId, pageId), eq(pageWatchers.userId, userId)),
			)
			.limit(1),
	]);
	return { count: watchers[0]?.count ?? 0, watching: mine.length > 0 };
}

async function likeState(pageId: string, userId: string) {
	const [likes, mine] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(pageLikes)
			.where(eq(pageLikes.pageId, pageId)),
		db
			.select({ id: pageLikes.id })
			.from(pageLikes)
			.where(and(eq(pageLikes.pageId, pageId), eq(pageLikes.userId, userId)))
			.limit(1),
	]);
	return { count: likes[0]?.count ?? 0, liked: mine.length > 0 };
}

async function pageRestrictionRows(pageId: string) {
	return db
		.select({
			id: pageRestrictions.id,
			operation: pageRestrictions.operation,
			userId: pageRestrictions.userId,
			groupName: pageRestrictions.groupName,
			username: users.username,
			displayName: users.displayName,
		})
		.from(pageRestrictions)
		.leftJoin(users, eq(users.id, pageRestrictions.userId))
		.where(eq(pageRestrictions.pageId, pageId));
}

const mimeBase = (value: string | null) =>
	(value ?? "application/octet-stream").split(";")[0]?.trim().toLowerCase() ??
	"";

function isActiveMime(mimeType: string | null) {
	const base = mimeBase(mimeType);
	return (
		base === "text/html" ||
		base === "text/xml" ||
		base === "application/xml" ||
		base.endsWith("+xml") ||
		base === "application/javascript" ||
		base === "application/x-javascript" ||
		base === "text/javascript" ||
		base === "text/xsl"
	);
}

export function isInlineMime(mimeType: string | null) {
	const base = mimeBase(mimeType);
	if (isActiveMime(base)) return false;
	return (
		base.startsWith("image/") ||
		base.startsWith("audio/") ||
		base.startsWith("video/") ||
		base === "application/pdf" ||
		base === "text/plain"
	);
}

/** Thumbnails only preview raster images; SVG and documents go through the attachment route. */
function isRasterImageMime(mimeType: string | null) {
	const base = mimeBase(mimeType);
	return base.startsWith("image/") && !isActiveMime(base);
}

function safeFileName(value: string | undefined) {
	const name = [...basename(value ?? "attachment")]
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code > 31 && code !== 127;
		})
		.join("")
		.trim();
	return (name === "" ? "attachment" : name).slice(0, 255);
}

function storageRoot() {
	return resolve(env.ATTACHMENTS_DIR);
}

async function readableSpace(actor: CurrentUser, key: string) {
	const space = await loadSpaceRow(key);
	if (!space) throw new HttpError(404, "Space not found");
	const access = await loadWikiAccess(actor);
	if (!access.readableSpaceIds.has(space.id)) {
		throw new HttpError(404, "Space not found");
	}
	return { space, access };
}

export async function listSpaces(
	actor: CurrentUser,
	input: { type?: "global" | "personal"; query?: string },
) {
	const access = await loadWikiAccess(actor);
	const query = input.query ?? "";

	const filters = [];
	if (input.type) filters.push(eq(spaces.type, input.type));
	if (query !== "") {
		const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
		filters.push(
			sql`(${spaces.name} ilike ${pattern} or ${spaces.key} ilike ${pattern})`,
		);
	}
	const rows = await db
		.select()
		.from(spaces)
		.where(filters.length > 0 ? and(...filters) : undefined)
		.orderBy(asc(sql`lower(${spaces.name})`));

	return spaceSummaries(access, rows);
}

export async function getSpace(actor: CurrentUser, key: string) {
	const { space, access } = await readableSpace(actor, key);
	return spaceSummary(
		space,
		await homePageOf(space, access),
		await pageCount(space.id, access),
	);
}

export async function getSpaceTree(actor: CurrentUser, key: string) {
	const { space, access } = await readableSpace(actor, key);
	const roots = await spaceTreeRoots(space, access.hiddenPageIds);
	return roots
		.filter(
			(row) => !access.hiddenPageIds.has(row.id) && row.status === "current",
		)
		.map((row) => ({
			id: row.id,
			sourceId: row.sourceId,
			title: row.title,
			hasChildren: row.hasChildren,
		}));
}

export async function getSpaceWatch(actor: CurrentUser, key: string) {
	const { space } = await readableSpace(actor, key);
	const [row] = await db
		.select({ id: spaceWatchers.id })
		.from(spaceWatchers)
		.where(
			and(
				eq(spaceWatchers.spaceId, space.id),
				eq(spaceWatchers.userId, actor.id),
			),
		)
		.limit(1);
	return { watching: row !== undefined };
}

export async function setSpaceWatch(
	actor: CurrentUser,
	key: string,
	watching: boolean,
) {
	const { space } = await readableSpace(actor, key);
	if (watching) {
		await db
			.insert(spaceWatchers)
			.values({ spaceId: space.id, userId: actor.id })
			.onConflictDoNothing();
	} else {
		await db
			.delete(spaceWatchers)
			.where(
				and(
					eq(spaceWatchers.spaceId, space.id),
					eq(spaceWatchers.userId, actor.id),
				),
			);
	}
	return { watching };
}

async function readablePage(actor: CurrentUser, id: string) {
	const access = await loadWikiAccess(actor);
	const loaded = await loadReadablePage(access, id);
	if (!loaded) throw new HttpError(404, "Page not found");
	return { access, ...loaded };
}

export async function getPage(
	actor: CurrentUser,
	id: string,
	versionNumber?: number,
) {
	const { access, page, space } = await readablePage(actor, id);

	let bodyStorage = page.bodyStorage;
	let bodyHtml = page.bodyHtml;
	let versionNumberForPage = page.versionNumber;
	if (versionNumber !== undefined) {
		const version = await pageVersion(page.id, versionNumber);
		if (!version) throw new HttpError(404, "Version not found");
		bodyStorage = version.bodyStorage;
		bodyHtml = version.bodyHtml;
		versionNumberForPage = version.number;
	}

	const scope = scopeFor(actor, access, space);
	const peopleIds = [page.creatorId, page.lastModifierId].filter(
		(id): id is string => id !== null,
	);
	const [
		body,
		ancestors,
		labels,
		attachmentRows,
		commentRows,
		children,
		people,
	] = await Promise.all([
		renderPage(
			{
				...page,
				bodyStorage,
				bodyHtml,
				versionNumber: versionNumberForPage,
			},
			scope,
		),
		pageAncestors(access, page),
		pageLabelsFor(page.id),
		pageAttachmentVersions(access, page.id),
		pageCommentRows(page.id),
		childPages(page.id, access.hiddenPageIds),
		peopleIds.length > 0
			? db
					.select({
						id: users.id,
						username: users.username,
						displayName: users.displayName,
						avatarUrl: userAvatarSql(users.id),
					})
					.from(users)
					.where(inArray(users.id, peopleIds))
			: [],
	]);
	const creator = people.find((row) => row.id === page.creatorId);
	const modifier = people.find((row) => row.id === page.lastModifierId);

	const [watchers, likes, spaceWatch, restrictions] = await Promise.all([
		watchState(page.id, actor.id),
		likeState(page.id, actor.id),
		db
			.select({ id: spaceWatchers.id })
			.from(spaceWatchers)
			.where(
				and(
					eq(spaceWatchers.spaceId, space.id),
					eq(spaceWatchers.userId, actor.id),
				),
			)
			.limit(1),
		pageRestrictionRows(page.id),
	]);

	const attachmentViews = groupAttachments(attachmentRows);

	return {
		id: page.id,
		sourceId: page.sourceId,
		title: page.title,
		type: page.type,
		status: page.status,
		versionNumber: versionNumberForPage,
		space: {
			id: space.id,
			key: space.key,
			name: space.name,
			type: space.type,
			iconPath: space.iconPath,
		},
		ancestors,
		creator: userRef({
			id: creator?.id ?? null,
			username: creator?.username ?? null,
			displayName: creator?.displayName ?? null,
			avatarUrl: creator?.avatarUrl ?? null,
		}),
		lastModifier: userRef({
			id: modifier?.id ?? null,
			username: modifier?.username ?? null,
			displayName: modifier?.displayName ?? null,
			avatarUrl: modifier?.avatarUrl ?? null,
		}),
		created: iso(page.created),
		updated: iso(page.updated),
		bodyHtml: body,
		labels,
		attachments: attachmentViews,
		comments: await Promise.all(
			commentRows.map((row) => commentView(row, actor)),
		),
		children: children
			.filter((child) => !access.hiddenPageIds.has(child.id))
			.map((child) => ({
				id: child.id,
				sourceId: child.sourceId,
				title: child.title,
				hasChildren: child.hasChildren,
			})),
		watchers,
		likes,
		restricted: restrictions.some((row) => row.operation === "read"),
		spaceWatching: spaceWatch.length > 0,
	};
}

export async function getPageChildren(actor: CurrentUser, id: string) {
	const { access, page } = await readablePage(actor, id);
	const rows = await childPages(page.id, access.hiddenPageIds);
	return rows
		.filter((row) => !access.hiddenPageIds.has(row.id))
		.map((row) => ({
			id: row.id,
			sourceId: row.sourceId,
			title: row.title,
			hasChildren: row.hasChildren,
		}));
}

export async function listPageVersions(actor: CurrentUser, id: string) {
	const { page } = await readablePage(actor, id);
	const rows = await pageVersionsFor(page.id);
	return rows.map((row) => ({
		number: row.number,
		title: row.title,
		created: iso(row.created),
		message: row.message,
		minorEdit: row.minorEdit,
		author: userRef({
			id: row.authorId,
			username: row.authorUsername,
			displayName: row.authorDisplayName,
			avatarUrl: row.authorAvatarUrl,
		}),
		current: row.number === page.versionNumber,
	}));
}

export async function diffPageVersions(
	actor: CurrentUser,
	id: string,
	from: number,
	to: number,
) {
	const { access, page, space } = await readablePage(actor, id);

	const [before, after] = await Promise.all([
		pageVersion(page.id, from),
		pageVersion(page.id, to),
	]);
	if (!before || !after) throw new HttpError(404, "Version not found");
	const scope = scopeFor(actor, access, space);
	const [beforeHtml, afterHtml] = await Promise.all([
		renderPage(
			{
				...page,
				bodyStorage: before.bodyStorage,
				bodyHtml: before.bodyHtml,
			},
			scope,
		),
		renderPage(
			{ ...page, bodyStorage: after.bodyStorage, bodyHtml: after.bodyHtml },
			scope,
		),
	]);
	return {
		from: before.number,
		to: after.number,
		blocks: diffHtml(beforeHtml, afterHtml),
	};
}

export async function listComments(actor: CurrentUser, id: string) {
	const { page } = await readablePage(actor, id);
	const rows = await pageCommentRows(page.id);
	return Promise.all(rows.map((row) => commentView(row, actor)));
}

export async function createComment(
	actor: CurrentUser,
	id: string,
	input: CreateCommentInput,
) {
	const { page } = await readablePage(actor, id);
	const html = await sanitizeBodyHtml(input.bodyHtml);
	if (!html) throw new HttpError(400, "Comment is empty");

	const parentId = input.parentId ?? null;
	if (parentId) {
		const parent = await commentById(parentId);
		if (!parent || parent.pageId !== page.id) {
			throw new HttpError(400, "Parent comment not found");
		}
	}

	const [row] = await db
		.insert(pageComments)
		.values({
			sourceId: `local:${randomUUID()}`,
			pageId: page.id,
			parentId,
			authorId: actor.id,
			bodyHtml: html,
			bodyStorage: input.bodyHtml,
			created: new Date(),
			updated: new Date(),
			inline: input.inline ?? false,
			inlineMarkerRef: input.marker ?? null,
			inlineOriginalSelection: input.selection ?? null,
		})
		.returning();
	return {
		id: row.id,
		parentId: row.parentId,
		author: userRef({
			id: actor.id,
			username: actor.username,
			displayName: actor.displayName,
			avatarUrl: actor.avatarUrl,
		}),
		bodyHtml: row.bodyHtml === null ? null : sanitizeWikiBody(row.bodyHtml),
		created: iso(row.created),
		updated: iso(row.updated),
		inline: row.inline,
		inlineMarkerRef: row.inlineMarkerRef,
		inlineSelection: row.inlineOriginalSelection,
		resolved: row.resolved,
		canEdit: true,
	};
}

async function manageableComment(actor: CurrentUser, id: string) {
	const comment = await commentById(id);
	if (!comment) throw new HttpError(404, "Comment not found");
	const access = await loadWikiAccess(actor);
	const loaded = await loadReadablePage(access, comment.pageId);
	if (!loaded) throw new HttpError(404, "Comment not found");
	return { comment, ...loaded };
}

export async function updateComment(
	actor: CurrentUser,
	id: string,
	bodyHtml: string,
) {
	const { comment } = await manageableComment(actor, id);
	if (!canManageComment(actor, comment)) {
		throw new HttpError(
			403,
			"Only the author or an administrator can edit this",
		);
	}
	const html = await sanitizeBodyHtml(bodyHtml);
	if (!html) throw new HttpError(400, "Comment is empty");
	await db
		.update(pageComments)
		.set({
			bodyHtml: html,
			bodyStorage: bodyHtml,
			updated: new Date(),
		})
		.where(eq(pageComments.id, comment.id));
	const rows = await pageCommentRows(comment.pageId);
	const updated = rows.find((row) => row.id === comment.id);
	if (!updated) throw new HttpError(404, "Comment not found");
	return commentView(updated, actor);
}

export async function deleteComment(actor: CurrentUser, id: string) {
	const { comment, page, space } = await manageableComment(actor, id);
	if (!canManageComment(actor, comment)) {
		throw new HttpError(
			403,
			"Only the author or an administrator can delete this",
		);
	}
	await db.transaction(async (tx) => {
		await audit(tx, actor, {
			action: "wiki.comment.delete",
			entityType: "page_comment",
			entityId: comment.id,
			summary: `Deleted a comment on page "${page.title}" in space ${space.key}`,
		});
		await tx.delete(pageComments).where(eq(pageComments.id, comment.id));
	});
}

export async function resolveComment(
	actor: CurrentUser,
	id: string,
	resolved: boolean,
) {
	const { comment, page } = await manageableComment(actor, id);
	if (!comment.inline) {
		throw new HttpError(400, "Only inline comments can be resolved");
	}
	if (
		!canManageComment(actor, comment) &&
		!(await pageAccess(actor, page)).edit
	) {
		throw new HttpError(
			403,
			"Only the author, an editor of the page or an administrator can resolve this",
		);
	}
	await db
		.update(pageComments)
		.set({ resolved, updated: new Date() })
		.where(eq(pageComments.id, comment.id));
	const rows = await pageCommentRows(comment.pageId);
	const updated = rows.find((row) => row.id === comment.id);
	if (!updated) throw new HttpError(404, "Comment not found");
	return commentView(updated, actor);
}

export async function listPageAttachments(actor: CurrentUser, id: string) {
	const { access, page } = await readablePage(actor, id);
	return groupAttachments(await pageAttachmentVersions(access, page.id));
}

export async function pageForUpload(actor: CurrentUser, id: string) {
	const page = await loadPageRow(id);
	if (!page) throw new HttpError(404, "Page not found");
	const access = await pageAccess(actor, page);
	if (!access.read) throw new HttpError(404, "Page not found");
	if (page.status === "trashed") {
		throw new HttpError(409, "Page is in the trash");
	}
	if (!access.edit) throw new HttpError(403, "Forbidden");
	return page;
}

/** Stores a parsed upload on a page; the permission check and the file cap are here, not in the caller. */
export async function uploadPageAttachments(
	actor: CurrentUser,
	pageId: string,
	upload: UploadedForm,
) {
	const root = storageRoot();
	const created: (typeof pageAttachments.$inferSelect)[] = [];

	try {
		const page = await pageForUpload(actor, pageId);
		if (upload.files.length > MAX_UPLOAD_FILES) {
			throw tooManyFiles(attachmentUploadLimits().tooManyFilesMessage);
		}
		await db.transaction(async (tx) => {
			for (const file of upload.files) {
				const uploadId = randomUUID();
				const sha256 = await hashFile(file.path);
				await mkdir(join(root, sha256), { recursive: true });
				await rename(file.path, join(root, sha256, uploadId));
				file.path = join(root, sha256, uploadId);

				const fileName = safeFileName(file.fileName);
				let row: typeof pageAttachments.$inferSelect | undefined;
				for (let attempt = 0; attempt < 5 && !row; attempt++) {
					const [inserted] = await tx
						.insert(pageAttachments)
						.values({
							sourceId: `local:${uploadId}`,
							pageId: page.id,
							fileName,
							mimeType: file.mimeType,
							size: file.size,
							version: sql`(
								select coalesce(max(${pageAttachments.version}), 0) + 1
								from ${pageAttachments}
								where ${pageAttachments.pageId} = ${page.id}
									and ${pageAttachments.fileName} = ${fileName}
							)`,
							authorId: actor.id,
							created: new Date(),
							storagePath: join(sha256, uploadId),
							sha256,
						})
						.onConflictDoNothing({
							target: [
								pageAttachments.pageId,
								pageAttachments.fileName,
								pageAttachments.version,
							],
						})
						.returning();
					row = inserted;
				}
				if (!row) {
					throw new HttpError(500, "Could not store the attachment");
				}
				created.push(row);
			}
		});
	} catch (error) {
		// Files the helper left in its temporary directory are not ours to keep.
		for (const file of upload.files) {
			await unlink(file.path).catch(() => undefined);
		}
		throw error;
	}

	if (created.length === 0) {
		throw new HttpError(400, "No files were uploaded");
	}
	return created.map((row) => ({
		id: row.id,
		fileName: row.fileName,
		mimeType: row.mimeType,
		size: row.size,
		version: row.version,
		author: userRef({
			id: actor.id,
			username: actor.username,
			displayName: actor.displayName,
			avatarUrl: actor.avatarUrl,
		}),
		created: iso(row.created),
		comment: row.comment,
		url: `/api/wiki/attachments/${row.id}`,
	}));
}

export async function deleteAttachment(actor: CurrentUser, id: string) {
	const row = await pageAttachmentById(id);
	if (!row) throw new HttpError(404, "Attachment not found");
	const access = await loadWikiAccess(actor);
	const loaded = await loadReadablePage(access, row.pageId);
	if (!loaded) throw new HttpError(404, "Attachment not found");
	if (row.authorId !== actor.id && !actor.isAdmin) {
		throw new HttpError(
			403,
			"Only the author or an administrator can delete this",
		);
	}
	await db.transaction(async (tx) => {
		await audit(tx, actor, {
			action: "wiki.attachment.delete",
			entityType: "page_attachment",
			entityId: row.id,
			summary: `Deleted version ${row.version} of attachment "${row.fileName}" from page "${loaded.page.title}" in space ${loaded.space.key}`,
		});
		await tx.delete(pageAttachments).where(eq(pageAttachments.id, row.id));
	});
	await removeOrphanFiles([row.storagePath]);
}

export async function listPageLabels(actor: CurrentUser, id: string) {
	const { page } = await readablePage(actor, id);
	return pageLabelsFor(page.id);
}

async function insertPageLabel(pageId: string, label: string) {
	const normalized = label.toLowerCase();
	const [row] = await db
		.insert(pageLabels)
		.values({
			sourceId: `local:${randomUUID()}`,
			pageId,
			label: normalized,
		})
		.onConflictDoNothing()
		.returning();
	if (row) {
		return {
			created: true,
			label: { id: row.id, label: row.label },
		};
	}
	const [existing] = await db
		.select({ id: pageLabels.id, label: pageLabels.label })
		.from(pageLabels)
		.where(and(eq(pageLabels.pageId, pageId), eq(pageLabels.label, normalized)))
		.limit(1);
	if (!existing) throw new HttpError(400, "Label not added");
	return { created: false, label: existing };
}

/** Adds a label and returns it in the API shape. */
export async function addPageLabel(
	actor: CurrentUser,
	id: string,
	label: string,
) {
	return (await ensurePageLabel(actor, id, label)).label;
}

/** Like `addPageLabel`, and says whether the label is new, so an endpoint can answer 201 or 200. */
export async function ensurePageLabel(
	actor: CurrentUser,
	id: string,
	label: string,
) {
	const { page } = await readablePage(actor, id);
	const permissions = await pageAccess(actor, page);
	if (!permissions.edit) throw new HttpError(403, "Forbidden");
	await assertNotLockedByOthers(db, page.id, actor.id);
	return insertPageLabel(page.id, label);
}

export async function deleteLabel(actor: CurrentUser, id: string) {
	const [label] = await db
		.select()
		.from(pageLabels)
		.where(eq(pageLabels.id, id))
		.limit(1);
	if (!label) throw new HttpError(404, "Label not found");
	const access = await loadWikiAccess(actor);
	const loaded = await loadReadablePage(access, label.pageId);
	if (!loaded) throw new HttpError(404, "Label not found");
	const permissions = await pageAccess(actor, loaded.page);
	if (!permissions.edit) throw new HttpError(403, "Forbidden");
	await assertNotLockedByOthers(db, loaded.page.id, actor.id);
	await db.delete(pageLabels).where(eq(pageLabels.id, label.id));
}

export async function getPageWatch(actor: CurrentUser, id: string) {
	const { page } = await readablePage(actor, id);
	return watchState(page.id, actor.id);
}

export async function setPageWatch(
	actor: CurrentUser,
	id: string,
	watching: boolean,
) {
	const { page } = await readablePage(actor, id);
	if (watching) {
		await db
			.insert(pageWatchers)
			.values({ pageId: page.id, userId: actor.id })
			.onConflictDoNothing();
	} else {
		await db
			.delete(pageWatchers)
			.where(
				and(
					eq(pageWatchers.pageId, page.id),
					eq(pageWatchers.userId, actor.id),
				),
			);
	}
	return watchState(page.id, actor.id);
}

export async function togglePageLike(actor: CurrentUser, id: string) {
	const { page } = await readablePage(actor, id);
	const [existing] = await db
		.select({ id: pageLikes.id })
		.from(pageLikes)
		.where(and(eq(pageLikes.pageId, page.id), eq(pageLikes.userId, actor.id)))
		.limit(1);
	if (existing) {
		await db.delete(pageLikes).where(eq(pageLikes.id, existing.id));
	} else {
		await db
			.insert(pageLikes)
			.values({ pageId: page.id, userId: actor.id })
			.onConflictDoNothing();
	}
	return likeState(page.id, actor.id);
}

export async function getPageRestrictions(actor: CurrentUser, id: string) {
	const { page, space } = await readablePage(actor, id);
	const permissions = await pageAccess(actor, page);

	const spaceRows =
		permissions.edit || permissions.administer
			? await db
					.select({
						id: spacePermissions.id,
						permission: spacePermissions.permission,
						userId: spacePermissions.userId,
						groupName: spacePermissions.groupName,
						anonymous: spacePermissions.anonymous,
						username: users.username,
						displayName: users.displayName,
						avatarUrl: userAvatarSql(users.id),
					})
					.from(spacePermissions)
					.leftJoin(users, eq(users.id, spacePermissions.userId))
					.where(eq(spacePermissions.spaceId, space.id))
					.orderBy(asc(spacePermissions.permission))
			: [];

	const pageRows = await pageRestrictionRows(page.id);
	return {
		space: spaceRows.map((row) => ({
			id: row.id,
			permission: row.permission,
			user: userRef({
				id: row.userId,
				username: row.username,
				displayName: row.displayName,
				avatarUrl: row.avatarUrl,
			}),
			groupName: row.groupName,
			anonymous: row.anonymous,
		})),
		page: pageRows.map((row) => ({
			id: row.id,
			operation: row.operation,
			user: userRef({
				id: row.userId,
				username: row.username,
				displayName: row.displayName,
				avatarUrl: null,
			}),
			groupName: row.groupName,
		})),
	};
}

export async function searchPages(actor: CurrentUser, input: SearchInput) {
	const access = await loadWikiAccess(actor);
	return searchWikiPages(access, { ...input, spaceKey: input.space });
}

export async function suggestPages(
	actor: CurrentUser,
	query: string,
	limit: number,
) {
	const access = await loadWikiAccess(actor);
	return suggestWikiPages(access, query, limit);
}

export async function recentPages(
	actor: CurrentUser,
	input: { limit: number; space?: string },
) {
	const access = await loadWikiAccess(actor);
	let spaceIds = [...access.readableSpaceIds];
	if (input.space) {
		const space = await loadSpaceRow(input.space);
		spaceIds = space && spaceIds.includes(space.id) ? [space.id] : [];
	}
	const rows = await recentPageLinks(access, spaceIds, {
		limit: input.limit,
	});
	return rows.map((row) => ({
		id: row.id,
		sourceId: row.sourceId,
		title: row.title,
		spaceKey: row.spaceKey,
		spaceName: row.spaceName,
		updated: row.updated,
		author: row.author,
	}));
}

export async function wikiHome(actor: CurrentUser) {
	const access = await loadWikiAccess(actor);

	const recent = await recentPageLinks(access, [...access.readableSpaceIds], {
		limit: 15,
	});

	const spaceRows = await db
		.select()
		.from(spaces)
		.orderBy(asc(sql`lower(${spaces.name})`));
	const summaries = await spaceSummaries(access, spaceRows);

	const createdRows = await db.execute(sql`
		select p.id, p.source_id, p.title, s.key as space_key, s.name as space_name
		from pages p
		join spaces s on s.id = p.space_id
		where p.creator_id = ${actor.id}
			and p.status = 'current'
			and ${visibleSql(access)}
		order by p.updated desc nulls last
		limit 10
	`);
	const watchedRows = await db.execute(sql`
		select p.id, p.source_id, p.title, s.key as space_key, s.name as space_name
		from page_watchers w
		join pages p on p.id = w.page_id
		join spaces s on s.id = p.space_id
		where w.user_id = ${actor.id}
			and p.status = 'current'
			and ${visibleSql(access)}
		order by p.updated desc nulls last
		limit 10
	`);

	const mapRow = (row: Record<string, unknown>) => ({
		id: String(row.id),
		sourceId: String(row.source_id),
		title: String(row.title),
		spaceKey: String(row.space_key),
		spaceName: String(row.space_name),
	});

	return {
		recent: recent.map((row) => ({
			id: row.id,
			sourceId: row.sourceId,
			title: row.title,
			spaceKey: row.spaceKey,
			spaceName: row.spaceName,
			updated: row.updated,
			author: row.author,
		})),
		spaces: summaries,
		created: (createdRows.rows as Record<string, unknown>[]).map(mapRow),
		watched: (watchedRows.rows as Record<string, unknown>[]).map(mapRow),
	};
}

export async function pagesByLabel(actor: CurrentUser, name: string) {
	const access = await loadWikiAccess(actor);
	const rows = await db.execute(sql`
		select distinct on (p.id) p.id, p.source_id, p.title, p.updated,
			s.key as space_key, s.name as space_name, u.display_name as author
		from pages p
		join spaces s on s.id = p.space_id
		join page_labels l on l.page_id = p.id
		left join users u on u.id = p.last_modifier_id
		where l.label = ${name.toLowerCase()}
			and p.status = 'current'
			and ${visibleSql(access)}
		order by p.id, p.updated desc nulls last
	`);
	return (rows.rows as Record<string, unknown>[])
		.map((row) => ({
			id: String(row.id),
			sourceId: String(row.source_id),
			title: String(row.title),
			spaceKey: String(row.space_key),
			spaceName: String(row.space_name),
			updated:
				row.updated === null
					? null
					: new Date(row.updated as string).toISOString(),
			author: row.author === null ? null : String(row.author),
		}))
		.sort((left, right) => left.title.localeCompare(right.title));
}

export async function resolvePage(actor: CurrentUser, input: ResolveInput) {
	const access = await loadWikiAccess(actor);

	if (input.pageId) {
		const loaded = await loadReadablePage(access, input.pageId);
		if (!loaded) throw new HttpError(404, "Page not found");
		return {
			id: loaded.page.id,
			sourceId: loaded.page.sourceId,
			spaceKey: loaded.space.key,
		};
	}
	if (input.spaceKey && input.title !== undefined) {
		const loaded = await findPageByTitle(access, input.spaceKey, input.title);
		if (!loaded) throw new HttpError(404, "Page not found");
		return {
			id: loaded.page.id,
			sourceId: loaded.page.sourceId,
			spaceKey: loaded.space.key,
		};
	}
	throw new HttpError(400, "Provide pageId or spaceKey and title");
}

export async function getPageVersion(
	actor: CurrentUser,
	id: string,
	number: number,
) {
	const { access, page, space } = await readablePage(actor, id);
	const version = await pageVersion(page.id, number);
	if (!version) throw new HttpError(404, "Version not found");
	const [author] = version.authorId
		? await db
				.select({
					id: users.id,
					username: users.username,
					displayName: users.displayName,
					avatarUrl: userAvatarSql(users.id),
				})
				.from(users)
				.where(eq(users.id, version.authorId))
				.limit(1)
		: [];
	const scope = scopeFor(actor, access, space);
	const body = await renderPage(
		{
			...page,
			bodyStorage: version.bodyStorage,
			bodyHtml: version.bodyHtml,
		},
		scope,
	);
	return {
		number: version.number,
		title: version.title,
		created: iso(version.created),
		message: version.message,
		minorEdit: version.minorEdit,
		author: userRef({
			id: author?.id ?? null,
			username: author?.username ?? null,
			displayName: author?.displayName ?? null,
			avatarUrl: author?.avatarUrl ?? null,
		}),
		bodyHtml: body,
		current: version.number === page.versionNumber,
	};
}

export async function getPageAncestors(actor: CurrentUser, id: string) {
	const { access, page } = await readablePage(actor, id);
	return pageAncestors(access, page);
}

export async function getPageAttachmentByName(
	actor: CurrentUser,
	id: string,
	name: string,
) {
	const { page } = await readablePage(actor, id);
	const row = await pageAttachmentByName(page.id, name);
	if (!row) throw new HttpError(404, "Attachment not found");
	return {
		id: row.id,
		fileName: row.fileName,
		mimeType: row.mimeType,
		size: row.size,
		version: row.version,
		url: `/download/attachments/${page.sourceId}/${encodeURIComponent(row.fileName)}?version=${row.version}`,
	};
}

export async function listTemplates(actor: CurrentUser, space?: string) {
	const access = await loadWikiAccess(actor);
	const rows = await db
		.select({
			id: pageTemplates.id,
			name: pageTemplates.name,
			description: pageTemplates.description,
			spaceKey: spaces.key,
			spaceId: pageTemplates.spaceId,
			bodyStorage: pageTemplates.bodyStorage,
		})
		.from(pageTemplates)
		.leftJoin(spaces, eq(spaces.id, pageTemplates.spaceId))
		.orderBy(asc(sql`lower(${pageTemplates.name})`));
	return rows
		.filter(
			(row) => row.spaceId === null || access.readableSpaceIds.has(row.spaceId),
		)
		.filter((row) => !space || row.spaceKey === space)
		.map((row) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			spaceKey: row.spaceKey,
			bodyStorage: row.bodyStorage,
		}));
}

export async function getPageExcerpt(
	actor: CurrentUser,
	id: string,
	query: string,
) {
	const { page } = await readablePage(actor, id);
	return { excerpt: searchExcerpt(page.bodyHtml, query) };
}

export type DownloadFile = {
	filePath: string;
	fileName: string;
	mimeType: string | null;
	size?: number;
	inline: boolean;
};

async function storedFile(
	row: typeof pageAttachments.$inferSelect,
	inlineParam: string | undefined,
): Promise<DownloadFile> {
	const root = storageRoot();
	const filePath = resolve(root, row.storagePath);
	if (filePath !== root && !filePath.startsWith(root + sep)) {
		throw new HttpError(404, "Attachment not found");
	}
	let size: number;
	try {
		size = (await stat(filePath)).size;
	} catch {
		throw new HttpError(404, "Attachment file is missing");
	}
	const active = isActiveMime(row.mimeType);
	const inline =
		!active &&
		(inlineParam === "1" ||
			inlineParam === "true" ||
			(isInlineMime(row.mimeType) && inlineParam === undefined));
	return {
		filePath,
		fileName: row.fileName,
		mimeType: row.mimeType,
		size,
		inline,
	};
}

export async function attachmentDownload(
	actor: CurrentUser,
	id: string,
	inlineParam: string | undefined,
) {
	const row = z.uuid().safeParse(id).success
		? await pageAttachmentById(id)
		: null;
	const loaded =
		row && (await loadReadablePage(await loadWikiAccess(actor), row.pageId));
	if (!row || !loaded) throw new HttpError(404, "Attachment not found");
	return storedFile(row, inlineParam);
}

export async function attachmentDownloadByName(
	actor: CurrentUser,
	pageId: string,
	fileName: string,
	input: { version?: string; inline?: string },
) {
	const access = await loadWikiAccess(actor);
	const loaded = await loadReadablePage(access, pageId);
	if (!loaded) throw new HttpError(404, "Attachment not found");

	let version: number | undefined;
	if (input.version !== undefined) {
		version = Number(input.version);
		if (!Number.isInteger(version) || version < 1) {
			throw new HttpError(400, "Invalid version");
		}
	}
	const row = await pageAttachmentByName(loaded.page.id, fileName, version);
	if (!row) throw new HttpError(404, "Attachment not found");

	return storedFile(row, input.inline);
}

export async function thumbnailDownload(
	actor: CurrentUser,
	pageId: string,
	fileName: string,
): Promise<DownloadFile> {
	const access = await loadWikiAccess(actor);
	const loaded = await loadReadablePage(access, pageId);
	if (!loaded) throw new HttpError(404, "Attachment not found");
	const row = await pageAttachmentByName(loaded.page.id, fileName);
	if (!row || !isRasterImageMime(row.mimeType)) {
		throw new HttpError(404, "Attachment not found");
	}
	const root = storageRoot();
	const filePath = resolve(root, row.storagePath);
	if (!filePath.startsWith(root + sep)) {
		throw new HttpError(404, "Attachment not found");
	}
	return {
		filePath,
		fileName: row.fileName,
		mimeType: row.mimeType,
		inline: true,
	};
}

type AttachmentVersionRow = Awaited<
	ReturnType<typeof pageAttachmentVersions>
>[number];

/**
 * Latest version per file name; `pageAttachmentVersions` already orders by
 * file name and version descending, so the first row of a group is the latest.
 */
function groupAttachments(rows: AttachmentVersionRow[]) {
	const grouped = new Map<string, AttachmentVersionRow[]>();
	for (const row of rows) {
		const list = grouped.get(row.fileName) ?? [];
		list.push(row);
		grouped.set(row.fileName, list);
	}
	return [...grouped.values()].map((versions) => {
		const latest = versions[0] as AttachmentVersionRow;
		return {
			id: latest.id,
			fileName: latest.fileName,
			mimeType: latest.mimeType,
			size: latest.size,
			version: latest.version,
			author: userRef({
				id: latest.authorId,
				username: latest.authorUsername,
				displayName: latest.author,
				avatarUrl: latest.authorAvatarUrl,
			}),
			created: latest.created,
			comment: latest.comment,
			versions: versions.map((version) => ({
				version: version.version,
				size: version.size,
				created: version.created,
				author: userRef({
					id: version.authorId,
					username: version.authorUsername,
					displayName: version.author,
					avatarUrl: version.authorAvatarUrl,
				}),
			})),
		};
	});
}

function visibleSql(access: WikiAccess) {
	const ids = [...access.readableSpaceIds];
	const readable =
		ids.length > 0
			? sql`p.space_id in (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `,
				)})`
			: sql`false`;
	if (access.hiddenPageIds.size === 0) return readable;
	return sql`${readable} and p.id not in (${sql.join(
		[...access.hiddenPageIds].map((id) => sql`${id}`),
		sql`, `,
	)})`;
}
