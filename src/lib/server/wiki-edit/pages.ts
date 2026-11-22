import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { pageLabels, pages } from "../schema-wiki.ts";
import { pageDrafts } from "../schema-wiki-edit.ts";
import { requireAccess, requireGrant } from "./access.ts";
import {
	assertCurrent,
	docSchema,
	fail,
	labelsSchema,
	loadPage,
	loadSpace,
	newSourceId,
	normalizeLabels,
	pageRef,
	titleSchema,
} from "./common.ts";
import {
	checkDoc,
	docOf,
	insertFirstVersion,
	loadVersion,
	lockPage,
	renderBody,
	writeVersion,
} from "./content.ts";
import {
	assertTitleFree,
	checkParent,
	lockSiblings,
	nextPosition,
	setLabels,
	titleClash,
} from "./helpers.ts";
import { assertNotLockedByOthers } from "./locks.ts";

export const createBody = z.object({
	spaceKey: z.string().min(1),
	parentId: z.uuid().nullish(),
	title: titleSchema,
	bodyDoc: docSchema,
	labels: labelsSchema.optional(),
	message: z.string().max(2000).optional(),
	draftPageId: z.uuid().optional(),
});

export const updateBody = z.object({
	title: titleSchema.optional(),
	bodyDoc: docSchema,
	baseVersion: z.number().int().optional(),
	message: z.string().max(2000).optional(),
	minorEdit: z.boolean().optional(),
	labels: labelsSchema.optional(),
	notifyWatchers: z.boolean().optional(),
});

export const restoreVersionBody = z.object({
	version: z.number().int().positive(),
	message: z.string().max(2000).optional(),
});

export const renameBody = z.object({ title: titleSchema });

export const labelsBody = z.object({ labels: labelsSchema });

export async function createPage(
	actor: CurrentUser,
	body: z.infer<typeof createBody>,
) {
	const space = await loadSpace(db, body.spaceKey);
	await requireGrant(actor, space.id, "create");
	const doc = checkDoc(body.bodyDoc);
	await checkParent(db, actor, space, body.parentId ?? null);
	const parentId = body.parentId ?? space.homePageId;

	let draftId: string | null = null;
	if (body.draftPageId) {
		const { page: draft } = await loadPage(db, body.draftPageId);
		if (draft.status !== "draft" || draft.spaceId !== space.id) {
			fail(400, "Not an unpublished page of this space");
		}
		await requireAccess(actor, draft, "edit");
		draftId = draft.id;
	}
	await assertTitleFree(db, space.id, body.title);

	const created = await titleClash(body.title, () =>
		db.transaction(async (tx) => {
			await lockSiblings(tx, space.id, parentId);
			if (draftId) {
				const draft = await lockPage(tx, draftId);
				if (draft.status !== "draft" || draft.spaceId !== space.id) {
					fail(409, "This page is no longer an unpublished draft");
				}
				await requireAccess(actor, draft, "edit");
			}
			const rendered = await renderBody(tx, doc, space.key, draftId);
			const now = new Date();
			const values = {
				spaceId: space.id,
				parentId,
				position: await nextPosition(tx, space.id, parentId),
				title: body.title,
				status: "current" as const,
				versionNumber: 1,
				...rendered,
				lastModifierId: actor.id,
				created: now,
				updated: now,
				updatedAt: now,
			};
			const [page] = draftId
				? await tx
						.update(pages)
						.set(values)
						.where(eq(pages.id, draftId))
						.returning()
				: await tx
						.insert(pages)
						.values({
							...values,
							sourceId: newSourceId(),
							creatorId: actor.id,
						})
						.returning();
			await insertFirstVersion(tx, page, actor, body.message ?? null);
			await setLabels(tx, page.id, normalizeLabels(body.labels));
			if (draftId) {
				await tx.delete(pageDrafts).where(eq(pageDrafts.pageId, draftId));
			}
			return page;
		}),
	);
	return pageRef(created, space.key);
}

export async function updatePage(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof updateBody>,
) {
	const { page, space } = await loadPage(db, id);
	await requireAccess(actor, page, "edit");
	assertCurrent(page);
	const doc = checkDoc(body.bodyDoc);
	await assertNotLockedByOthers(db, page.id, actor.id);
	const title = body.title ?? page.title;
	if (title !== page.title) await assertTitleFree(db, space.id, title, page.id);

	const updated = await titleClash(title, () =>
		db.transaction(async (tx) => {
			const fresh = await lockPage(tx, page.id);
			await assertNotLockedByOthers(tx, page.id, actor.id);
			if (
				body.baseVersion !== undefined &&
				body.baseVersion !== fresh.versionNumber
			) {
				fail(409, "The page was changed since you opened it", {
					currentVersion: fresh.versionNumber,
				});
			}
			const rendered = await renderBody(tx, doc, space.key, page.id);
			const row = await writeVersion(
				tx,
				fresh,
				actor,
				{ title, ...rendered },
				{ message: body.message, minorEdit: body.minorEdit },
			);
			if (body.labels) {
				await setLabels(tx, page.id, normalizeLabels(body.labels));
			}
			await tx
				.delete(pageDrafts)
				.where(
					and(eq(pageDrafts.pageId, page.id), eq(pageDrafts.userId, actor.id)),
				);
			return row;
		}),
	);
	return pageRef(updated, space.key);
}

export async function restoreVersion(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof restoreVersionBody>,
) {
	const { page, space } = await loadPage(db, id);
	await requireAccess(actor, page, "edit");
	assertCurrent(page);
	await assertNotLockedByOthers(db, page.id, actor.id);
	const version = await loadVersion(db, page.id, body.version);
	const doc = checkDoc(docOf(version));

	const updated = await db.transaction(async (tx) => {
		const fresh = await lockPage(tx, page.id);
		await assertNotLockedByOthers(tx, page.id, actor.id);
		const rendered = await renderBody(tx, doc, space.key, page.id);
		return writeVersion(
			tx,
			fresh,
			actor,
			{ title: fresh.title, ...rendered },
			{
				message: body.message ?? `Restored version ${version.number}`,
			},
		);
	});
	return pageRef(updated, space.key);
}

export async function renamePage(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof renameBody>,
) {
	const { title } = body;
	const { page, space } = await loadPage(db, id);
	await requireAccess(actor, page, "edit");
	assertCurrent(page);
	await assertNotLockedByOthers(db, page.id, actor.id);
	if (title === page.title) return pageRef(page, space.key);
	await assertTitleFree(db, space.id, title, page.id);

	const updated = await titleClash(title, () =>
		db.transaction(async (tx) => {
			const fresh = await lockPage(tx, page.id);
			await assertNotLockedByOthers(tx, page.id, actor.id);
			return writeVersion(
				tx,
				fresh,
				actor,
				{
					title,
					bodyStorage: fresh.bodyStorage,
					bodyHtml: fresh.bodyHtml,
					bodyDoc: fresh.bodyDoc,
				},
				{ message: `Renamed from "${fresh.title}"`, minorEdit: true },
			);
		}),
	);
	return pageRef(updated, space.key);
}

export async function setPageLabels(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof labelsBody>,
) {
	const { page } = await loadPage(db, id);
	await requireAccess(actor, page, "edit");
	assertCurrent(page);
	const labels = normalizeLabels(body.labels);
	await db.transaction((tx) => setLabels(tx, page.id, labels));
	const rows = await db
		.select({ label: pageLabels.label })
		.from(pageLabels)
		.where(eq(pageLabels.pageId, page.id))
		.orderBy(pageLabels.label);
	return { labels: rows.map((row) => row.label) };
}
