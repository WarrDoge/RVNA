import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { pageAttachments, pages } from "../schema-wiki.ts";
import { pageDrafts } from "../schema-wiki-edit.ts";
import { loadReadablePage } from "../wiki/pages.ts";
import { loadWikiAccess } from "../wiki/permissions.ts";
import { requireAccess, requireGrant } from "./access.ts";
import {
	docSchema,
	fail,
	labelsSchema,
	loadPage,
	loadSpace,
	newSourceId,
	normalizeLabels,
} from "./common.ts";
import { checkDoc } from "./content.ts";
import { removeOrphanFiles } from "./files.ts";

export const createDraftBody = z.object({
	spaceKey: z.string().min(1),
	parentId: z.uuid().nullish(),
});

export const saveDraftBody = z.object({
	title: z.string().max(255),
	bodyDoc: docSchema,
	labels: labelsSchema.optional(),
	baseVersion: z.number().int().optional(),
});

export async function createDraft(
	actor: CurrentUser,
	input: z.infer<typeof createDraftBody>,
) {
	const space = await loadSpace(db, input.spaceKey);
	await requireGrant(actor, space.id, "create");
	const parentId = input.parentId ?? null;
	if (parentId) {
		const { page: parent } = await loadPage(db, parentId);
		if (parent.spaceId !== space.id || parent.status !== "current") {
			fail(400, "Parent page is not a current page of this space");
		}
		await requireAccess(actor, parent, "read");
	}

	const [untouched] = await db
		.select({ pageId: pageDrafts.pageId, id: pageDrafts.id })
		.from(pageDrafts)
		.innerJoin(pages, eq(pages.id, pageDrafts.pageId))
		.where(
			and(
				eq(pageDrafts.userId, actor.id),
				eq(pageDrafts.spaceId, space.id),
				eq(pages.status, "draft"),
				eq(pages.creatorId, actor.id),
				parentId
					? eq(pages.parentId, parentId)
					: sql`${pages.parentId} is null`,
				eq(pageDrafts.title, ""),
				sql`${pageDrafts.bodyDoc} is null`,
			),
		)
		.limit(1);
	if (untouched?.pageId) {
		return {
			created: false,
			pageId: untouched.pageId,
			draftId: untouched.id,
		};
	}

	const result = await db.transaction(async (tx) => {
		const now = new Date();
		const [page] = await tx
			.insert(pages)
			.values({
				sourceId: newSourceId(),
				spaceId: space.id,
				parentId,
				title: "",
				status: "draft",
				versionNumber: 0,
				creatorId: actor.id,
				created: now,
			})
			.returning({ id: pages.id });
		const [draft] = await tx
			.insert(pageDrafts)
			.values({
				userId: actor.id,
				pageId: page.id,
				spaceId: space.id,
				parentId,
			})
			.returning({ id: pageDrafts.id });
		return { pageId: page.id, draftId: draft.id };
	});
	return { created: true, ...result };
}

export async function saveDraft(
	actor: CurrentUser,
	id: string,
	input: z.infer<typeof saveDraftBody>,
) {
	const { page } = await loadPage(db, id);
	await requireAccess(actor, page, "edit");
	if (page.status === "trashed") fail(409, "Page is in the trash");
	const doc = checkDoc(input.bodyDoc);
	const now = new Date();
	const values = {
		parentId: page.parentId,
		title: input.title,
		bodyDoc: doc as unknown as Record<string, unknown>,
		labels: normalizeLabels(input.labels),
		updatedAt: now,
	};
	const baseVersion = input.baseVersion ?? page.versionNumber;
	const [row] = await db
		.insert(pageDrafts)
		.values({
			userId: actor.id,
			pageId: page.id,
			spaceId: page.spaceId,
			baseVersion,
			...values,
		})
		.onConflictDoUpdate({
			target: [pageDrafts.userId, pageDrafts.pageId],
			targetWhere: sql`page_id is not null`,
			set: {
				...values,
				...(input.baseVersion !== undefined && { baseVersion }),
			},
		})
		.returning({ id: pageDrafts.id });
	return { id: row.id, updatedAt: now.toISOString() };
}

export async function discardDraft(actor: CurrentUser, id: string) {
	const access = await loadWikiAccess(actor);
	const loaded = await loadReadablePage(access, id);
	if (!loaded) fail(404, "Page not found");
	const { page } = loaded;
	await db
		.delete(pageDrafts)
		.where(
			and(eq(pageDrafts.pageId, page.id), eq(pageDrafts.userId, actor.id)),
		);
	if (page.status === "draft" && page.creatorId === actor.id) {
		const files = await db
			.select({ path: pageAttachments.storagePath })
			.from(pageAttachments)
			.where(eq(pageAttachments.pageId, page.id));
		await db.delete(pages).where(eq(pages.id, page.id));
		await removeOrphanFiles(files.map((file) => file.path));
	}
}
