import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
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
import { requireAccess, requireGrant } from "./access.ts";
import {
	assertCurrent,
	fail,
	loadPage,
	loadSpace,
	newSourceId,
	type PageRow,
	pageRef,
	titleSchema,
} from "./common.ts";
import { removeOrphanFiles } from "./files.ts";
import {
	assertTitleFree,
	checkParent,
	descendantIds,
	lockSiblings,
	nextPosition,
	setPositions,
	siblingIds,
	titleClash,
} from "./helpers.ts";

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

export async function movePage(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof moveBody>,
) {
	const { page, space } = await loadPage(db, id);
	await requireAccess(actor, page, "edit");
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

	const subtree = await descendantIds(db, page.id);
	if (parentId && (parentId === page.id || subtree.includes(parentId))) {
		fail(400, "A page cannot be moved under itself");
	}
	await checkParent(db, actor, target, parentId);

	const moving = [page.id, ...subtree];
	if (crossSpace) {
		const titles = await db
			.select({ title: pages.title })
			.from(pages)
			.where(and(inArray(pages.id, moving), eq(pages.status, "current")));
		const [clash] = await db
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

	const moved = await titleClash(page.title, () =>
		db.transaction(async (tx) => {
			await lockSiblings(tx, target.id, parentId);
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
	await requireAccess(actor, source, "read");
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
	const restrictionRows = await db
		.select()
		.from(pageRestrictions)
		.where(inArray(pageRestrictions.pageId, oldIds));
	const attachmentIdMap = new Map(
		attachmentRows.map((row) => [row.id, randomUUID()]),
	);
	const rewrite = (value: string) => {
		let out = value;
		for (const [from, to] of attachmentIdMap) out = out.replaceAll(from, to);
		return out;
	};

	const now = new Date();
	const created = await titleClash(body.title, () =>
		db.transaction(async (tx) => {
			await lockSiblings(tx, target.id, parentId);
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
				bodyHtml: node.row.bodyHtml && rewrite(node.row.bodyHtml),
				bodyDoc:
					node.row.bodyDoc &&
					(JSON.parse(rewrite(JSON.stringify(node.row.bodyDoc))) as Record<
						string,
						unknown
					>),
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
			if (restrictionRows.length > 0) {
				await tx.insert(pageRestrictions).values(
					restrictionRows.map((row) => ({
						sourceId: newSourceId(),
						pageId: newIdOf.get(row.pageId) as string,
						operation: row.operation,
						userId: row.userId,
						groupName: row.groupName,
					})),
				);
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
	await requireAccess(actor, page, "trash");
	assertCurrent(page);
	if (space.homePageId === page.id) {
		fail(409, "The space home page cannot be moved to the trash");
	}

	const trashed = await db.transaction(async (tx) => {
		const kids = await siblingIds(tx, space.id, page.id);
		const existing = await siblingIds(tx, space.id, page.parentId, page.id);
		await tx
			.update(pages)
			.set({ parentId: page.parentId })
			.where(eq(pages.parentId, page.id));
		await setPositions(tx, [...existing, ...kids]);
		await tx
			.insert(pageTrash)
			.values({
				pageId: page.id,
				trashedBy: actor.id,
				originalParentId: page.parentId,
				originalPosition: page.position,
			})
			.onConflictDoUpdate({
				target: pageTrash.pageId,
				set: {
					trashedBy: actor.id,
					trashedAt: new Date(),
					originalParentId: page.parentId,
					originalPosition: page.position,
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
	await requireAccess(actor, page, "edit");
	if (page.status !== "trashed") fail(409, "Page is not in the trash");
	await assertTitleFree(db, space.id, page.title);

	const [trash] = await db
		.select()
		.from(pageTrash)
		.where(eq(pageTrash.pageId, page.id));
	let parentId: string | null = null;
	if (trash?.originalParentId) {
		const [parent] = await db
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

	const restored = await titleClash(page.title, () =>
		db.transaction(async (tx) => {
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
		!current.every((id) => listed.has(id))
	) {
		fail(400, "childIds must list every current child exactly once");
	}
	await setPositions(db, childIds);
}
