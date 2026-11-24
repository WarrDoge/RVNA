import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type DocNode, walkDoc } from "../../shared/wiki/index.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import {
	pageAttachments,
	pageLabels,
	pageRestrictions,
	pages,
	pageVersions,
	spaces,
} from "../schema-wiki.ts";
import { pageDrafts, pageLocks, pageTrash } from "../schema-wiki-edit.ts";
import { loadWikiAccess } from "../wiki/permissions.ts";
import { type PageAccess, requireAccess, requireGrant } from "./access.ts";
import {
	allow,
	assertCurrent,
	type Executor,
	fail,
	loadPage,
	loadSpace,
	newSourceId,
	type PageRow,
	pageRef,
	titleSchema,
} from "./common.ts";
import { attachmentUrl, lockPage } from "./content.ts";
import { removeOrphanFiles } from "./files.ts";
import {
	ancestors,
	assertTitleFree,
	checkParent,
	descendantIds,
	lockSiblings,
	nextPosition,
	setPositions,
	siblingIds,
	titleClash,
} from "./helpers.ts";
import { listed } from "./restrictions.ts";

function copyTitle(base: string, taken: Set<string>) {
	if (!taken.has(base)) return base;
	for (let n = 1; ; n++) {
		const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
		const title = base.slice(0, 255 - suffix.length) + suffix;
		if (!taken.has(title)) return title;
	}
}

export const moveBody = z.object({
	spaceKey: z.string().min(1).optional(),
	parentId: z.uuid().nullish(),
	position: z.number().int().min(0).optional(),
});

export const copyBody = z.object({
	title: titleSchema,
	spaceKey: z.string().min(1).optional(),
	parentId: z.uuid().nullish(),
	withChildren: z.boolean().optional(),
	withAttachments: z.boolean().optional(),
	withLabels: z.boolean().optional(),
});

export const orderBody = z.object({ childIds: z.array(z.uuid()) });

type Subjects = { userIds: string[]; groups: string[] };

/** The people and groups named by the read restriction of each page; a page without one has no entry. */
function readLists(
	rows: Pick<
		typeof pageRestrictions.$inferSelect,
		"pageId" | "operation" | "userId" | "groupName"
	>[],
) {
	const lists = new Map<string, Subjects>();
	for (const row of rows) {
		if (row.operation !== "read") continue;
		const list = lists.get(row.pageId) ?? { userIds: [], groups: [] };
		if (row.userId) list.userIds.push(row.userId);
		else if (row.groupName) list.groups.push(row.groupName);
		lists.set(row.pageId, list);
	}
	return lists;
}

async function loadReadLists(ex: Executor, ids: string[]) {
	if (ids.length === 0) return new Map<string, Subjects>();
	return readLists(
		await ex
			.select()
			.from(pageRestrictions)
			.where(inArray(pageRestrictions.pageId, ids)),
	);
}

/** Read restrictions of the pages above `pageId` that no longer apply once the page sits under `parentId`. */
async function lostReadLists(
	ex: Executor,
	pageId: string,
	parentId: string | null,
) {
	const kept = new Set<string>(
		parentId
			? [parentId, ...(await ancestors(ex, parentId)).map((row) => row.id)]
			: [],
	);
	const lost = (await ancestors(ex, pageId))
		.map((row) => row.id)
		.filter((id) => !kept.has(id));
	return loadReadLists(ex, lost);
}

/**
 * The read restriction a page takes along when the restrictions above it stop applying:
 * the people and groups named by every one of the given lists. Anything else could read
 * the page after the change but could not before it.
 */
function keptReadList(
	actor: CurrentUser,
	access: PageAccess,
	lists: Subjects[],
): Subjects {
	const [first, ...rest] = lists as [Subjects, ...Subjects[]];
	const kept = {
		userIds: first.userIds.filter((id) =>
			rest.every((list) => list.userIds.includes(id)),
		),
		groups: first.groups.filter((group) =>
			rest.every((list) =>
				list.groups.some(
					(other) => other.toLowerCase() === group.toLowerCase(),
				),
			),
		),
	};
	allow(
		kept.userIds.length + kept.groups.length > 0 &&
			(access.bypass || listed(actor, kept)),
		"The read restrictions of the pages above this page cannot be carried over to it. Ask someone who may change page restrictions to change them first.",
	);
	return kept;
}

const readRows = (pageId: string, list: Subjects) => [
	...list.userIds.map((userId) => ({
		sourceId: newSourceId(),
		pageId,
		operation: "read" as const,
		userId,
		groupName: null,
	})),
	...list.groups.map((groupName) => ({
		sourceId: newSourceId(),
		pageId,
		operation: "read" as const,
		userId: null,
		groupName,
	})),
];

/**
 * Called before `pageId` is put under `parentId`. A page that loses the read restriction of a page
 * above it would become readable by more people. Someone who may change restrictions on the page
 * may do that; for anyone else the page gets those restrictions as its own.
 */
async function keepReadAudience(
	tx: Executor,
	actor: CurrentUser,
	access: PageAccess,
	pageId: string,
	parentId: string | null,
) {
	if (access.restrict) return;
	const lost = await lostReadLists(tx, pageId, parentId);
	if (lost.size === 0) return;
	const own = (await loadReadLists(tx, [pageId])).get(pageId);
	const kept = keptReadList(actor, access, [
		...(own ? [own] : []),
		...lost.values(),
	]);
	await tx
		.delete(pageRestrictions)
		.where(
			and(
				eq(pageRestrictions.pageId, pageId),
				eq(pageRestrictions.operation, "read"),
			),
		);
	await tx.insert(pageRestrictions).values(readRows(pageId, kept));
}

export async function movePage(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof moveBody>,
) {
	const { page, space } = await loadPage(db, id);
	const access = await requireAccess(actor, page, "edit");
	assertCurrent(page);

	const target =
		body.spaceKey && body.spaceKey !== space.key
			? await loadSpace(db, body.spaceKey)
			: space;
	const crossSpace = target.id !== space.id;
	await requireGrant(actor, target.id, "create");
	const parentId =
		body.parentId !== undefined
			? body.parentId
			: crossSpace
				? null
				: page.parentId;
	if (
		!crossSpace &&
		parentId === page.parentId &&
		body.position === undefined
	) {
		return pageRef(page, space.key);
	}

	await checkParent(db, actor, target, parentId);

	const moved = await titleClash(page.title, () =>
		db.transaction(async (tx) => {
			await lockSiblings(tx, target.id, parentId);
			assertCurrent(await lockPage(tx, page.id));
			const subtree = await descendantIds(tx, page.id);
			if (parentId && (parentId === page.id || subtree.includes(parentId))) {
				fail(400, "A page cannot be moved under itself");
			}
			await keepReadAudience(tx, actor, access, page.id, parentId);
			const moving = [page.id, ...subtree];
			if (crossSpace) {
				const titles = await tx
					.select({ title: pages.title })
					.from(pages)
					.where(and(inArray(pages.id, moving), eq(pages.status, "current")));
				const [clash] = await tx
					.select({ title: pages.title })
					.from(pages)
					.where(
						and(
							eq(pages.spaceId, target.id),
							eq(pages.status, "current"),
							inArray(
								pages.title,
								titles.map((row) => row.title),
							),
						),
					)
					.limit(1);
				if (clash) {
					fail(
						409,
						`A page titled "${clash.title}" already exists in the target space`,
					);
				}
			}
			if (crossSpace) {
				await tx
					.update(pages)
					.set({ spaceId: target.id })
					.where(inArray(pages.id, moving));
				await tx
					.update(pageDrafts)
					.set({ spaceId: target.id })
					.where(inArray(pageDrafts.pageId, moving));
				await tx
					.update(spaces)
					.set({ homePageId: null })
					.where(
						and(eq(spaces.id, space.id), inArray(spaces.homePageId, moving)),
					);
			}
			const [row] = await tx
				.update(pages)
				.set({ parentId })
				.where(eq(pages.id, page.id))
				.returning();
			const siblings = await siblingIds(tx, target.id, parentId, page.id);
			const at = Math.min(body.position ?? siblings.length, siblings.length);
			siblings.splice(at, 0, page.id);
			await setPositions(tx, siblings);
			return row as PageRow;
		}),
	);
	return pageRef(moved, target.key);
}

export async function copyPage(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof copyBody>,
) {
	const { page: source, space } = await loadPage(db, id);
	const access = await requireAccess(actor, source, "read");
	assertCurrent(source);

	const target =
		body.spaceKey && body.spaceKey !== space.key
			? await loadSpace(db, body.spaceKey)
			: space;
	const crossSpace = target.id !== space.id;
	await requireGrant(actor, target.id, "create");
	const parentId =
		body.parentId !== undefined
			? body.parentId
			: crossSpace
				? null
				: source.parentId;
	await checkParent(db, actor, target, parentId);
	await assertTitleFree(db, target.id, body.title);

	const nodes: {
		row: PageRow;
		newId: string;
		newParentId: string | null;
		title: string;
		position: number;
	}[] = [];
	const taken = new Set(
		(
			await db
				.select({ title: pages.title })
				.from(pages)
				.where(and(eq(pages.spaceId, target.id), eq(pages.status, "current")))
		).map((row) => row.title),
	);
	taken.add(body.title);
	const topId = randomUUID();
	nodes.push({
		row: source,
		newId: topId,
		newParentId: parentId,
		title: body.title,
		position: 0,
	});

	if (body.withChildren) {
		const below = await descendantIds(db, source.id);
		const rows = below.length
			? await db
					.select()
					.from(pages)
					.where(and(inArray(pages.id, below), eq(pages.status, "current")))
					.orderBy(asc(pages.position), asc(pages.title))
			: [];
		const wiki = await loadWikiAccess(actor);
		const children = new Map<string, PageRow[]>();
		for (const row of rows) {
			if (!row.parentId || wiki.hiddenPageIds.has(row.id)) continue;
			children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
		}
		const walk = (oldId: string, newId: string) => {
			(children.get(oldId) ?? []).forEach((row, position) => {
				const title = copyTitle(row.title, taken);
				taken.add(title);
				const id = randomUUID();
				nodes.push({ row, newId: id, newParentId: newId, title, position });
				walk(row.id, id);
			});
		};
		walk(source.id, topId);
	}

	const oldIds = nodes.map((node) => node.row.id);
	const newIdOf = new Map(nodes.map((node) => [node.row.id, node.newId]));
	const attachmentRows = body.withAttachments
		? await db
				.select()
				.from(pageAttachments)
				.where(inArray(pageAttachments.pageId, oldIds))
		: [];
	const attachmentIdMap = new Map(
		attachmentRows.map((row) => [row.id, randomUUID()]),
	);
	const attachmentRefs = new Map(
		attachmentRows.map((row) => [
			attachmentUrl(row.id),
			attachmentUrl(attachmentIdMap.get(row.id) as string),
		]),
	);
	const rewriteDoc = (doc: Record<string, unknown>) => {
		const copy = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
		walkDoc(copy as DocNode, (node) => {
			if (node.attrs && typeof node.attrs.src === "string") {
				const src = attachmentRefs.get(node.attrs.src);
				if (src) node.attrs = { ...node.attrs, src };
			}
			for (const mark of node.marks ?? []) {
				const href = mark.attrs?.href;
				if (typeof href !== "string") continue;
				const mapped = attachmentRefs.get(href);
				if (mapped) mark.attrs = { ...mark.attrs, href: mapped };
			}
		});
		return copy;
	};
	const rewriteHtml = (value: string) => {
		let out = value;
		for (const [from, to] of attachmentRefs) out = out.replaceAll(from, to);
		return out;
	};

	const now = new Date();
	const created = await titleClash(body.title, () =>
		db.transaction(async (tx) => {
			await lockSiblings(tx, target.id, parentId);
			assertCurrent(await lockPage(tx, source.id));
			const restrictionRows = await tx
				.select()
				.from(pageRestrictions)
				.where(inArray(pageRestrictions.pageId, oldIds));
			// The copy is never readable by more people than the source is. Pages below it sit under
			// the copy, so only the copy itself needs the read restrictions it leaves behind.
			const lost = await lostReadLists(tx, source.id, parentId);
			const own = readLists(restrictionRows).get(source.id);
			const kept =
				lost.size > 0
					? keptReadList(actor, access, [
							...(own ? [own] : []),
							...lost.values(),
						])
					: null;
			(nodes[0] as (typeof nodes)[number]).position = await nextPosition(
				tx,
				target.id,
				parentId,
			);
			const values = nodes.map((node) => ({
				id: node.newId,
				sourceId: newSourceId(),
				spaceId: target.id,
				parentId: node.newParentId,
				position: node.position,
				title: node.title,
				type: node.row.type,
				status: "current" as const,
				versionNumber: 1,
				bodyStorage: node.row.bodyStorage,
				bodyHtml: node.row.bodyHtml && rewriteHtml(node.row.bodyHtml),
				bodyDoc: node.row.bodyDoc && rewriteDoc(node.row.bodyDoc),
				creatorId: actor.id,
				created: now,
				lastModifierId: actor.id,
				updated: now,
			}));
			const inserted = await tx.insert(pages).values(values).returning();
			await tx.insert(pageVersions).values(
				inserted.map((row) => ({
					sourceId: newSourceId(),
					pageId: row.id,
					number: 1,
					title: row.title,
					bodyStorage: row.bodyStorage,
					bodyHtml: row.bodyHtml,
					bodyDoc: row.bodyDoc,
					authorId: actor.id,
					created: now,
					message: "Copied from another page",
				})),
			);
			const restrictions = [
				...restrictionRows
					.filter(
						(row) =>
							!(kept && row.pageId === source.id && row.operation === "read"),
					)
					.map((row) => ({
						sourceId: newSourceId(),
						pageId: newIdOf.get(row.pageId) as string,
						operation: row.operation,
						userId: row.userId,
						groupName: row.groupName,
					})),
				...(kept ? readRows(topId, kept) : []),
			];
			if (restrictions.length > 0) {
				await tx.insert(pageRestrictions).values(restrictions);
			}
			if (attachmentRows.length > 0) {
				await tx.insert(pageAttachments).values(
					attachmentRows.map((row) => ({
						id: attachmentIdMap.get(row.id),
						sourceId: newSourceId(),
						pageId: newIdOf.get(row.pageId) as string,
						fileName: row.fileName,
						mimeType: row.mimeType,
						size: row.size,
						version: row.version,
						authorId: row.authorId,
						created: row.created,
						comment: row.comment,
						storagePath: row.storagePath,
						sha256: row.sha256,
					})),
				);
			}
			if (body.withLabels) {
				const labels = await tx
					.select()
					.from(pageLabels)
					.where(inArray(pageLabels.pageId, oldIds));
				if (labels.length > 0) {
					await tx.insert(pageLabels).values(
						labels.map((row) => ({
							sourceId: newSourceId(),
							pageId: newIdOf.get(row.pageId) as string,
							label: row.label,
						})),
					);
				}
			}
			return inserted.find((row) => row.id === topId) as PageRow;
		}),
	);
	return pageRef(created, target.key);
}

export async function trashPage(actor: CurrentUser, id: string) {
	const { page, space } = await loadPage(db, id);
	const access = await requireAccess(actor, page, "trash");
	assertCurrent(page);
	if (space.homePageId === page.id) {
		fail(409, "The space home page cannot be moved to the trash");
	}

	const trashed = await db.transaction(async (tx) => {
		await lockSiblings(tx, space.id, page.parentId);
		const fresh = await lockPage(tx, page.id);
		assertCurrent(fresh);
		if (fresh.parentId !== page.parentId) {
			fail(409, "The page was moved while it was being trashed");
		}
		const kids = await siblingIds(tx, space.id, page.id);
		const existing = await siblingIds(tx, space.id, page.parentId, page.id);
		const moved = await tx
			.update(pages)
			.set({ parentId: page.parentId })
			.where(eq(pages.parentId, page.id))
			.returning({ id: pages.id });
		// The children leave the read restriction of this page behind, like a move out of it.
		if (moved.length > 0 && !access.restrict) {
			allow(
				(await loadReadLists(tx, [page.id])).size === 0,
				"This page has a read restriction and pages below it. Only someone who may change page restrictions can move it to the trash.",
			);
		}
		await setPositions(tx, [...existing, ...kids]);
		const movedChildren = moved.map((row) => row.id);
		await tx
			.insert(pageTrash)
			.values({
				pageId: page.id,
				trashedBy: actor.id,
				originalParentId: page.parentId,
				originalPosition: page.position,
				movedChildren,
			})
			.onConflictDoUpdate({
				target: pageTrash.pageId,
				set: {
					trashedBy: actor.id,
					trashedAt: new Date(),
					originalParentId: page.parentId,
					originalPosition: page.position,
					movedChildren,
				},
			});
		await tx.delete(pageLocks).where(eq(pageLocks.pageId, page.id));
		const [row] = await tx
			.update(pages)
			.set({ status: "trashed", updatedAt: new Date() })
			.where(eq(pages.id, page.id))
			.returning();
		return row as PageRow;
	});
	return pageRef(trashed, space.key);
}

export async function restorePage(actor: CurrentUser, id: string) {
	const { page, space } = await loadPage(db, id);
	const access = await requireAccess(actor, page, "trash");
	if (page.status !== "trashed") fail(409, "Page is not in the trash");
	await assertTitleFree(db, space.id, page.title);

	const restored = await titleClash(page.title, () =>
		db.transaction(async (tx) => {
			const fresh = await lockPage(tx, page.id);
			if (fresh.status !== "trashed") fail(409, "Page is not in the trash");
			const [trash] = await tx
				.select()
				.from(pageTrash)
				.where(eq(pageTrash.pageId, page.id));
			let parentId: string | null = null;
			if (trash?.originalParentId) {
				const [parent] = await tx
					.select({ id: pages.id })
					.from(pages)
					.where(
						and(
							eq(pages.id, trash.originalParentId),
							eq(pages.spaceId, space.id),
							eq(pages.status, "current"),
						),
					);
				parentId = parent?.id ?? null;
			}
			await keepReadAudience(tx, actor, access, page.id, parentId);

			const siblings = await siblingIds(tx, space.id, parentId);
			const at = Math.min(
				trash?.originalPosition ?? siblings.length,
				siblings.length,
			);
			siblings.splice(at, 0, page.id);
			const [row] = await tx
				.update(pages)
				.set({ status: "current", parentId, updatedAt: new Date() })
				.where(eq(pages.id, page.id))
				.returning();
			await setPositions(tx, siblings);
			if (trash && trash.movedChildren.length > 0) {
				// Only the children that still sit where the trash put them: one that was moved since stays.
				const back = await tx
					.update(pages)
					.set({ parentId: page.id })
					.where(
						and(
							sql`${pages.id} = any(${sql.param(trash.movedChildren)}::uuid[])`,
							eq(pages.spaceId, space.id),
							trash.originalParentId
								? eq(pages.parentId, trash.originalParentId)
								: isNull(pages.parentId),
						),
					)
					.returning({ id: pages.id });
				if (back.length > 0) {
					await setPositions(tx, await siblingIds(tx, space.id, page.id));
				}
			}
			await tx.delete(pageTrash).where(eq(pageTrash.pageId, page.id));
			return row as PageRow;
		}),
	);
	return pageRef(restored, space.key);
}

export async function purgePage(actor: CurrentUser, id: string) {
	const { page } = await loadPage(db, id);
	await requireAccess(actor, page, "administer");
	if (page.status !== "trashed") {
		fail(409, "Only pages in the trash can be deleted permanently");
	}
	const files = await db
		.select({ path: pageAttachments.storagePath })
		.from(pageAttachments)
		.where(eq(pageAttachments.pageId, page.id));
	await db.delete(pages).where(eq(pages.id, page.id));
	await removeOrphanFiles(files.map((file) => file.path));
}

export async function reorderChildren(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof orderBody>,
) {
	const { page } = await loadPage(db, id);
	await requireAccess(actor, page, "edit");
	assertCurrent(page);
	const { childIds } = body;
	const current = await siblingIds(db, page.spaceId, page.id);
	const listed = new Set(childIds);
	if (
		listed.size !== childIds.length ||
		listed.size !== current.length ||
		!current.every((childId) => listed.has(childId))
	) {
		fail(400, "childIds must list every current child exactly once");
	}
	await setPositions(db, childIds);
}
