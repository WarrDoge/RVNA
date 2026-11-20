import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type {
	DraftInfo,
	EditorContext,
	EditorSpace,
	PageSearchHit,
	SpaceTreeNode,
	TrashEntry,
} from "../../shared/wiki/index.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { groups } from "../schema.ts";
import { pageAttachments, pageLabels, pages, spaces } from "../schema-wiki.ts";
import { pageDrafts, pageTrash } from "../schema-wiki-edit.ts";
import {
	loadWikiAccess,
	spaceReadable,
	type WikiAccess,
} from "../wiki/permissions.ts";
import {
	allSpaceGrants,
	can,
	grantsFor,
	pageAccess,
	requireReadableSpace,
	spaceGrants,
} from "./access.ts";
import { fail, loadPage, loadSpace, loadUserRefs, pageRef } from "./common.ts";
import { attachmentUrl, docOf } from "./content.ts";
import { ancestors } from "./helpers.ts";
import { lockState } from "./locks.ts";

const escapeLike = (text: string) => text.replace(/[%_\\]/g, "\\$&");

async function editorContext(
	user: CurrentUser,
	pageId: string,
	given?: typeof pageDrafts.$inferSelect,
	wiki?: WikiAccess,
): Promise<EditorContext> {
	const { page, space } = await loadPage(db, pageId);
	if (page.status === "trashed") fail(404, "Page not found");
	const access = await pageAccess(user, page, wiki);
	if (!access.read) fail(404, "Page not found");

	const draftRow =
		given ??
		(
			await db
				.select()
				.from(pageDrafts)
				.where(
					and(eq(pageDrafts.pageId, page.id), eq(pageDrafts.userId, user.id)),
				)
				.limit(1)
		)[0];
	const [labels, files, lock, crumbs, refs] = await Promise.all([
		db
			.select({ label: pageLabels.label })
			.from(pageLabels)
			.where(eq(pageLabels.pageId, page.id))
			.orderBy(pageLabels.label),
		db
			.select()
			.from(pageAttachments)
			.where(eq(pageAttachments.pageId, page.id))
			.orderBy(asc(pageAttachments.version)),
		lockState(db, page.id),
		ancestors(db, page.id),
		loadUserRefs(db, [page.lastModifierId]),
	]);
	const latest = new Map(files.map((file) => [file.fileName, file]));
	const draft: DraftInfo | null = draftRow
		? {
				id: draftRow.id,
				pageId: draftRow.pageId,
				spaceKey: space.key,
				parentId: draftRow.parentId,
				title: draftRow.title,
				bodyDoc: draftRow.bodyDoc as DraftInfo["bodyDoc"],
				labels: draftRow.labels,
				baseVersion: draftRow.baseVersion,
				updatedAt: draftRow.updatedAt.toISOString(),
			}
		: null;
	return {
		page: {
			...pageRef(page, space.key),
			bodyDoc: docOf(page),
			spaceName: space.name,
			updated: page.updated?.toISOString() ?? null,
			lastModifier: page.lastModifierId
				? (refs.get(page.lastModifierId) ?? null)
				: null,
		},
		breadcrumb: crumbs.reverse(),
		labels: labels.map((row) => row.label),
		draft,
		lock: lock?.live ? lock.info : null,
		permissions: {
			canEdit: access.edit,
			canRestrict: access.restrict,
			canDelete: access.trash,
		},
		attachments: [...latest.values()]
			.sort((a, b) => a.fileName.localeCompare(b.fileName))
			.map((file) => ({
				id: file.id,
				fileName: file.fileName,
				mimeType: file.mimeType,
				size: file.size,
				url: attachmentUrl(file.id),
			})),
	};
}

export const searchQuery = z.object({
	q: z.string().trim().max(200).default(""),
	spaceKey: z.string().min(1).optional(),
});

export const groupsQuery = z.object({
	q: z.string().trim().max(200).default(""),
});

export async function getEditorContext(
	actor: CurrentUser,
	id: string,
	wiki?: WikiAccess,
) {
	return editorContext(actor, id, undefined, wiki);
}

export async function getDraftContext(
	actor: CurrentUser,
	draftId: string,
	wiki?: WikiAccess,
) {
	const [draft] = await db
		.select()
		.from(pageDrafts)
		.where(and(eq(pageDrafts.id, draftId), eq(pageDrafts.userId, actor.id)));
	if (!draft?.pageId) fail(404, "Draft not found");
	return editorContext(actor, draft.pageId, draft, wiki);
}

export async function listEditorSpaces(actor: CurrentUser, wiki?: WikiAccess) {
	const all = await allSpaceGrants(actor);
	const access = wiki ?? (await loadWikiAccess(actor));
	const rows = await db
		.select({ id: spaces.id, key: spaces.key, name: spaces.name })
		.from(spaces)
		.where(eq(spaces.status, "current"))
		.orderBy(sql`lower(${spaces.name})`);
	const result: EditorSpace[] = [];
	for (const row of rows) {
		if (!spaceReadable(access, row.id)) continue;
		result.push({
			key: row.key,
			name: row.name,
			canCreate: can(grantsFor(all, row.id), "create"),
		});
	}
	return result;
}

export async function searchPages(
	actor: CurrentUser,
	query: z.infer<typeof searchQuery>,
) {
	const { q, spaceKey } = query;
	const wiki = await loadWikiAccess(actor);
	const readable = [...wiki.readableSpaceIds];
	if (readable.length === 0) return [];

	const pattern = `${escapeLike(q)}%`;
	const rows = await db
		.select({
			id: pages.id,
			title: pages.title,
			spaceKey: spaces.key,
			spaceName: spaces.name,
		})
		.from(pages)
		.innerJoin(spaces, eq(spaces.id, pages.spaceId))
		.where(
			and(
				eq(pages.status, "current"),
				eq(pages.type, "page"),
				q ? ilike(pages.title, `%${escapeLike(q)}%`) : undefined,
				spaceKey ? eq(spaces.key, spaceKey) : undefined,
				inArray(pages.spaceId, readable),
			),
		)
		.orderBy(
			...(q
				? [sql`${pages.title} ilike ${pattern} desc`, asc(pages.title)]
				: [desc(pages.updatedAt)]),
		)
		.limit(60);
	const hits: PageSearchHit[] = rows
		.filter((row) => !wiki.hiddenPageIds.has(row.id))
		.slice(0, 20);
	return hits;
}

export async function getSpaceTree(
	actor: CurrentUser,
	spaceKey: string,
	wiki?: WikiAccess,
) {
	const space = await loadSpace(db, spaceKey);
	const access = await requireReadableSpace(actor, space.id, wiki);
	const rows = await db
		.select({
			id: pages.id,
			title: pages.title,
			parentId: pages.parentId,
			position: pages.position,
		})
		.from(pages)
		.where(
			and(
				eq(pages.spaceId, space.id),
				eq(pages.status, "current"),
				eq(pages.type, "page"),
			),
		)
		.orderBy(asc(pages.position), asc(pages.title));
	return rows.filter(
		(row) => !access.hiddenPageIds.has(row.id),
	) satisfies SpaceTreeNode[];
}

export async function listTrash(
	actor: CurrentUser,
	spaceKey: string,
	wiki?: WikiAccess,
) {
	const space = await loadSpace(db, spaceKey);
	const access = await requireReadableSpace(actor, space.id, wiki);
	const rows = await db
		.select({ page: pages, trash: pageTrash })
		.from(pages)
		.leftJoin(pageTrash, eq(pageTrash.pageId, pages.id))
		.where(and(eq(pages.spaceId, space.id), eq(pages.status, "trashed")));
	const refs = await loadUserRefs(
		db,
		rows.map((row) => row.trash?.trashedBy ?? null),
	);
	const entries: TrashEntry[] = rows
		.filter((row) => !access.hiddenPageIds.has(row.page.id))
		.map((row) => ({
			page: pageRef(row.page, space.key),
			trashedAt: (
				row.trash?.trashedAt ??
				row.page.updated ??
				row.page.updatedAt
			).toISOString(),
			trashedBy: row.trash?.trashedBy
				? (refs.get(row.trash.trashedBy) ?? null)
				: null,
		}))
		.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
	return entries;
}

/** The page fields the copy, move and remove screens read, without loading the editor body. */
export async function pageEditSummary(actor: CurrentUser, id: string) {
	const { page, space } = await loadPage(db, id);
	if (page.status === "trashed") fail(404, "Page not found");
	const access = await pageAccess(actor, page);
	if (!access.read) fail(404, "Page not found");
	const crumbs = await ancestors(db, page.id);
	return {
		page: pageRef(page, space.key),
		spaceName: space.name,
		breadcrumb: crumbs.reverse(),
		permissions: { canDelete: access.trash },
	};
}

/** The trash buttons the actor may use: delete restores, administer purges. */
export async function trashPermissions(actor: CurrentUser, spaceKey: string) {
	const space = await loadSpace(db, spaceKey);
	const grants = await spaceGrants(actor, space.id);
	return {
		canRestore: can(grants, "delete") || can(grants, "delete_own"),
		canPurge: can(grants, "administer"),
	};
}

/** Group names for the restriction picker: the actor's own groups, or every group for an administrator. */
export async function listGroups(
	actor: CurrentUser,
	query: z.infer<typeof groupsQuery>,
) {
	const pattern = `%${escapeLike(query.q)}%`;
	const rows = await db
		.select({ name: groups.name })
		.from(groups)
		.where(
			actor.isAdmin
				? ilike(groups.name, pattern)
				: and(
						ilike(groups.name, pattern),
						sql`lower(${groups.name}) = any(${sql.param(
							actor.groups.map((name) => name.toLowerCase()),
						)}::text[])`,
					),
		)
		.orderBy(sql`lower(${groups.name})`)
		.limit(20);
	return rows.map((row) => row.name);
}
