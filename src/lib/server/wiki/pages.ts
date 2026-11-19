import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import {
	pageAttachments,
	pageComments,
	pageLabels,
	pages,
	pageVersions,
	spaces,
	users,
} from "../schema.ts";
import type { WikiAccess } from "./permissions.ts";

export type PageRow = typeof pages.$inferSelect;
export type SpaceRow = typeof spaces.$inferSelect;

export const pageRefColumns = {
	id: pages.id,
	sourceId: pages.sourceId,
	title: pages.title,
	spaceId: pages.spaceId,
	parentId: pages.parentId,
	position: pages.position,
	status: pages.status,
	type: pages.type,
	versionNumber: pages.versionNumber,
};

/**
 * Loads a page by our uuid or by the imported Confluence id used in URLs.
 * Returns null when the page does not exist; callers check permissions.
 */
export async function loadPageRow(
	idOrSourceId: string,
): Promise<PageRow | null> {
	const trimmed = idOrSourceId.trim();
	if (trimmed === "") return null;
	if (z.uuid().safeParse(trimmed).success) {
		const [row] = await db
			.select()
			.from(pages)
			.where(eq(pages.id, trimmed))
			.limit(1);
		if (row) return row;
	}
	const [row] = await db
		.select()
		.from(pages)
		.where(eq(pages.sourceId, trimmed))
		.limit(1);
	return row ?? null;
}

export async function loadSpaceRow(key: string): Promise<SpaceRow | null> {
	const [row] = await db
		.select()
		.from(spaces)
		.where(eq(spaces.key, key))
		.limit(1);
	return row ?? null;
}

async function loadSpaceRowById(id: string): Promise<SpaceRow | null> {
	const [row] = await db
		.select()
		.from(spaces)
		.where(eq(spaces.id, id))
		.limit(1);
	return row ?? null;
}

export function canReadPage(access: WikiAccess, page: PageRow) {
	return (
		access.readableSpaceIds.has(page.spaceId) &&
		!access.hiddenPageIds.has(page.id)
	);
}

/** Trashed pages are gone; an unpublished draft is visible to its creator and to administrators. */
export async function loadReadablePage(
	access: WikiAccess,
	idOrSourceId: string,
): Promise<{ page: PageRow; space: SpaceRow } | null> {
	const page = await loadPageRow(idOrSourceId);
	if (!page || page.status === "trashed" || !canReadPage(access, page)) {
		return null;
	}
	if (
		page.status === "draft" &&
		!access.isAdmin &&
		page.creatorId !== access.userId
	) {
		return null;
	}
	const space = await loadSpaceRowById(page.spaceId);
	if (!space) return null;
	return { page, space };
}

export async function findPageByTitle(
	access: WikiAccess,
	spaceKey: string,
	title: string,
): Promise<{ page: PageRow; space: SpaceRow } | null> {
	const space = await loadSpaceRow(spaceKey);
	if (!space || !access.readableSpaceIds.has(space.id)) return null;
	const [page] = await db
		.select()
		.from(pages)
		.where(
			and(
				eq(pages.spaceId, space.id),
				eq(pages.title, title),
				eq(pages.status, "current"),
			),
		)
		.limit(1);
	if (!page || access.hiddenPageIds.has(page.id)) return null;
	return { page, space };
}

export type Ancestor = { id: string; sourceId: string; title: string };

export async function pageAncestors(page: PageRow): Promise<Ancestor[]> {
	const ancestors: Ancestor[] = [];
	let current = page.parentId;
	const seen = new Set<string>();
	while (current && !seen.has(current)) {
		seen.add(current);
		const [row] = await db
			.select({
				id: pages.id,
				sourceId: pages.sourceId,
				title: pages.title,
				parentId: pages.parentId,
			})
			.from(pages)
			.where(eq(pages.id, current))
			.limit(1);
		if (!row) break;
		ancestors.unshift({
			id: row.id,
			sourceId: row.sourceId,
			title: row.title,
		});
		current = row.parentId;
	}
	return ancestors;
}

export async function hasChildren(pageId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: pages.id })
		.from(pages)
		.where(and(eq(pages.parentId, pageId), eq(pages.status, "current")))
		.limit(1);
	return row !== undefined;
}

export async function childPages(pageId: string) {
	const rows = await db
		.select(pageRefColumns)
		.from(pages)
		.where(and(eq(pages.parentId, pageId), eq(pages.status, "current")))
		.orderBy(asc(pages.position), asc(sql`lower(${pages.title})`));
	const withChildren = await Promise.all(
		rows.map(async (row) => ({
			...row,
			hasChildren: await hasChildren(row.id),
		})),
	);
	return withChildren;
}

/** Root pages of a space: the home page, or the pages without a parent. */
export async function spaceTreeRoots(space: SpaceRow) {
	if (space.homePageId) {
		const [home] = await db
			.select(pageRefColumns)
			.from(pages)
			.where(eq(pages.id, space.homePageId))
			.limit(1);
		if (home) {
			return [{ ...home, hasChildren: await hasChildren(home.id) }];
		}
	}
	const rows = await db
		.select(pageRefColumns)
		.from(pages)
		.where(
			and(
				eq(pages.spaceId, space.id),
				eq(pages.status, "current"),
				isNull(pages.parentId),
			),
		)
		.orderBy(asc(pages.position), asc(sql`lower(${pages.title})`));
	return Promise.all(
		rows.map(async (row) => ({
			...row,
			hasChildren: await hasChildren(row.id),
		})),
	);
}

export type VersionRow = typeof pageVersions.$inferSelect;

export async function pageVersionsFor(pageId: string) {
	return db
		.select({
			number: pageVersions.number,
			title: pageVersions.title,
			created: pageVersions.created,
			message: pageVersions.message,
			minorEdit: pageVersions.minorEdit,
			authorId: pageVersions.authorId,
			authorUsername: users.username,
			authorDisplayName: users.displayName,
			authorAvatarUrl: userAvatarSql(users.id),
		})
		.from(pageVersions)
		.leftJoin(users, eq(users.id, pageVersions.authorId))
		.where(eq(pageVersions.pageId, pageId))
		.orderBy(desc(pageVersions.number));
}

export async function pageVersion(pageId: string, number: number) {
	const [row] = await db
		.select()
		.from(pageVersions)
		.where(
			and(eq(pageVersions.pageId, pageId), eq(pageVersions.number, number)),
		)
		.limit(1);
	return row ?? null;
}

export async function pageLabelsFor(pageId: string) {
	return db
		.select({ id: pageLabels.id, label: pageLabels.label })
		.from(pageLabels)
		.where(eq(pageLabels.pageId, pageId))
		.orderBy(asc(sql`lower(${pageLabels.label})`));
}

export async function pageAttachmentByName(
	pageId: string,
	fileName: string,
	version?: number,
) {
	const filters = [
		eq(pageAttachments.pageId, pageId),
		eq(pageAttachments.fileName, fileName),
	];
	if (version !== undefined) {
		filters.push(eq(pageAttachments.version, version));
	}
	const [row] = await db
		.select()
		.from(pageAttachments)
		.where(and(...filters))
		.orderBy(desc(pageAttachments.version))
		.limit(1);
	return row ?? null;
}

export async function pageAttachmentById(id: string) {
	const [row] = await db
		.select()
		.from(pageAttachments)
		.where(eq(pageAttachments.id, id))
		.limit(1);
	return row ?? null;
}

export type CommentRow = typeof pageComments.$inferSelect;

export async function pageCommentRows(pageId: string) {
	return db
		.select({
			id: pageComments.id,
			parentId: pageComments.parentId,
			authorId: pageComments.authorId,
			authorUsername: users.username,
			authorDisplayName: users.displayName,
			authorAvatarUrl: userAvatarSql(users.id),
			bodyHtml: pageComments.bodyHtml,
			bodyStorage: pageComments.bodyStorage,
			created: pageComments.created,
			updated: pageComments.updated,
			inline: pageComments.inline,
			inlineMarkerRef: pageComments.inlineMarkerRef,
			inlineOriginalSelection: pageComments.inlineOriginalSelection,
			resolved: pageComments.resolved,
		})
		.from(pageComments)
		.leftJoin(users, eq(users.id, pageComments.authorId))
		.where(eq(pageComments.pageId, pageId))
		.orderBy(asc(pageComments.created), asc(pageComments.id));
}

export async function commentById(id: string) {
	const [row] = await db
		.select()
		.from(pageComments)
		.where(eq(pageComments.id, id))
		.limit(1);
	return row ?? null;
}

/**
 * Next Confluence-style page id for a page created in this app: one above the
 * highest numeric imported id. Call inside the transaction that inserts the
 * page so concurrent creators serialize on the advisory lock.
 */
export async function nextPageSourceId(
	executor: Pick<typeof db, "execute"> = db,
): Promise<string> {
	await executor.execute(
		sql`select pg_advisory_xact_lock(hashtext('wiki_page_source_id'))`,
	);
	const result = await executor.execute(sql`
		select coalesce(max(source_id::bigint), 1000) + 1 as next
		from pages
		where source_id ~ '^[0-9]+$'
	`);
	const row = (result.rows as { next: string | number }[])[0];
	return String(row?.next ?? 1001);
}

export async function pageCount(spaceId: string) {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(pages)
		.where(and(eq(pages.spaceId, spaceId), eq(pages.status, "current")));
	return row?.count ?? 0;
}

/** Pages created by, or watched by, the user across readable spaces. */
export async function pagesForUser(
	access: WikiAccess,
	userId: string,
	kind: "created" | "watched",
	limit = 10,
) {
	if (kind === "created") {
		const rows = await db.execute(sql`
			select p.id, p.source_id, p.title, s.key as space_key, s.name as space_name,
				p.updated, u.display_name as author
			from pages p
			join spaces s on s.id = p.space_id
			left join users u on u.id = p.last_modifier_id
			where p.creator_id = ${userId}
				and p.status = 'current'
				and ${spaceFilter(access)}
			order by p.updated desc nulls last
			limit ${limit}
		`);
		return rows.rows as {
			id: string;
			source_id: string;
			title: string;
			space_key: string;
			space_name: string;
			updated: Date | null;
			author: string | null;
		}[];
	}

	const rows = await db.execute(sql`
		select p.id, p.source_id, p.title, s.key as space_key, s.name as space_name,
			p.updated, u.display_name as author
		from page_watchers w
		join pages p on p.id = w.page_id
		join spaces s on s.id = p.space_id
		left join users u on u.id = p.last_modifier_id
		where w.user_id = ${userId}
			and p.status = 'current'
			and ${spaceFilter(access)}
		order by p.updated desc nulls last
		limit ${limit}
	`);
	return rows.rows as {
		id: string;
		source_id: string;
		title: string;
		space_key: string;
		space_name: string;
		updated: Date | null;
		author: string | null;
	}[];
}

function spaceFilter(access: WikiAccess) {
	const ids = [...access.readableSpaceIds];
	const readable =
		ids.length > 0
			? sql`p.space_id in (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `,
				)})`
			: sql`false`;
	if (access.hiddenPageIds.size === 0) return readable;
	const hidden = sql.join(
		[...access.hiddenPageIds].map((id) => sql`${id}`),
		sql`, `,
	);
	return sql`${readable} and p.id not in (${hidden})`;
}
