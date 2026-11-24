import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
	collectDocRefs,
	docToHtml,
	docToStorage,
	emptyDoc,
	type HtmlContext,
	resolveDocRefs,
	storageToDoc,
	validateDoc,
	type WikiDoc,
} from "../../shared/wiki/index.ts";
import type { CurrentUser } from "../auth.ts";
import {
	pageAttachments,
	pages,
	pageVersions,
	spaces,
} from "../schema-wiki.ts";
import { pageUrl } from "../wiki/data.ts";
import { loadWikiAccess, pageReadable } from "../wiki/permissions.ts";
import { type Executor, fail, newSourceId, type PageRow } from "./common.ts";

export type Body = {
	bodyStorage: string | null;
	bodyHtml: string | null;
	bodyDoc: Record<string, unknown> | null;
};

export function checkDoc(doc: unknown): WikiDoc {
	const error = validateDoc(doc);
	if (error) fail(400, `Invalid document: ${error}`);
	return doc as WikiDoc;
}

/** The document of a stored body: body_doc when present, else the converted storage format. */
export function docOf(body: {
	bodyDoc: Record<string, unknown> | null;
	bodyStorage: string | null;
}): WikiDoc {
	if (body.bodyDoc) return body.bodyDoc as WikiDoc;
	return body.bodyStorage ? storageToDoc(body.bodyStorage) : emptyDoc();
}

export const attachmentUrl = (id: string) => `/api/wiki/attachments/${id}`;

/**
 * Bulk-resolves the page links and attachment images of a document into hrefs.
 * A page the actor may not read stays unresolved, as if it did not exist.
 */
async function htmlContext(
	ex: Executor,
	doc: WikiDoc,
	spaceKey: string,
	pageId: string | null,
	actor: CurrentUser,
): Promise<HtmlContext> {
	const refs = collectDocRefs(doc, spaceKey);
	const titlesBySpace = new Map<string, Set<string>>();
	const normalizeSpaceKey = (key: string) => key.toLowerCase();
	const want = (key: string | undefined, title: string) => {
		const normalized = normalizeSpaceKey(key ?? spaceKey);
		const set = titlesBySpace.get(normalized) ?? new Set<string>();
		set.add(title);
		titlesBySpace.set(normalized, set);
	};
	for (const ref of refs.pages) want(ref.spaceKey, ref.title);
	for (const ref of refs.attachments) {
		if (ref.title) want(ref.spaceKey, ref.title);
	}

	const pageIds = new Map<string, string>();
	const mapKey = (key: string, title: string) =>
		`${normalizeSpaceKey(key)}\n${title}`;
	if (titlesBySpace.size > 0) {
		const rows = await ex
			.select({
				id: pages.id,
				spaceId: pages.spaceId,
				title: pages.title,
				key: spaces.key,
			})
			.from(pages)
			.innerJoin(spaces, eq(spaces.id, pages.spaceId))
			.where(
				and(
					eq(pages.status, "current"),
					or(
						...[...titlesBySpace].map(([key, titles]) =>
							and(
								sql`lower(${spaces.key}) = ${key}`,
								inArray(pages.title, [...titles]),
							),
						),
					),
				),
			);
		const access = rows.length > 0 ? await loadWikiAccess(actor) : null;
		for (const row of rows) {
			if (access && pageReadable(access, row)) {
				pageIds.set(mapKey(row.key, row.title), row.id);
			}
		}
	}

	const hostOf = (ref: { title?: string; spaceKey?: string }) =>
		ref.title
			? pageIds.get(mapKey(ref.spaceKey ?? spaceKey, ref.title))
			: (pageId ?? undefined);
	const hosts = new Set<string>();
	const names = new Set<string>();
	for (const ref of refs.attachments) {
		const host = hostOf(ref);
		if (host) {
			hosts.add(host);
			names.add(ref.fileName);
		}
	}
	const attachmentIds = new Map<string, string>();
	if (hosts.size > 0) {
		const rows = await ex
			.select({
				id: pageAttachments.id,
				pageId: pageAttachments.pageId,
				fileName: pageAttachments.fileName,
			})
			.from(pageAttachments)
			.where(
				and(
					inArray(pageAttachments.pageId, [...hosts]),
					inArray(pageAttachments.fileName, [...names]),
				),
			)
			.orderBy(pageAttachments.version);
		for (const row of rows) {
			attachmentIds.set(`${row.pageId}\n${row.fileName}`, row.id);
		}
	}

	return {
		defaultSpaceKey: spaceKey,
		pageHref: (ref) => {
			const id = pageIds.get(mapKey(ref.spaceKey ?? spaceKey, ref.title));
			return id ? pageUrl(id) : null;
		},
		attachmentHref: (ref) => {
			const host = hostOf(ref);
			const id = host && attachmentIds.get(`${host}\n${ref.fileName}`);
			return id ? attachmentUrl(id) : null;
		},
	};
}

/** Resolves references and generates body_html and body_storage from the document. */
export async function renderBody(
	ex: Executor,
	input: WikiDoc,
	spaceKey: string,
	pageId: string | null,
	actor: CurrentUser,
): Promise<Body> {
	const ctx = await htmlContext(ex, input, spaceKey, pageId, actor);
	const doc = resolveDocRefs(input, ctx);
	return {
		bodyDoc: doc,
		bodyHtml: docToHtml(doc, ctx),
		bodyStorage: docToStorage(doc),
	};
}

export async function lockPage(ex: Executor, id: string): Promise<PageRow> {
	const [row] = await ex
		.select()
		.from(pages)
		.where(eq(pages.id, id))
		.for("update");
	if (!row) fail(404, "Page not found");
	return row;
}

/**
 * Publishes the next version of a locked page: snapshots the current one when it has no
 * version row yet, updates the page and inserts the new version row.
 */
export async function writeVersion(
	tx: Executor,
	page: PageRow,
	user: CurrentUser,
	change: { title: string } & Body,
	meta: { message?: string | null; minorEdit?: boolean } = {},
): Promise<PageRow> {
	const [existing] = await tx
		.select({ id: pageVersions.id })
		.from(pageVersions)
		.where(
			and(
				eq(pageVersions.pageId, page.id),
				eq(pageVersions.number, page.versionNumber),
			),
		)
		.limit(1);
	if (!existing) {
		await tx.insert(pageVersions).values({
			sourceId: newSourceId(),
			pageId: page.id,
			number: page.versionNumber,
			title: page.title,
			bodyStorage: page.bodyStorage,
			bodyHtml: page.bodyHtml,
			bodyDoc: page.bodyDoc,
			authorId: page.lastModifierId ?? page.creatorId,
			created: page.updated ?? page.created,
		});
	}
	const now = new Date();
	const [updated] = await tx
		.update(pages)
		.set({
			...change,
			versionNumber: page.versionNumber + 1,
			lastModifierId: user.id,
			updated: now,
			updatedAt: now,
		})
		.where(eq(pages.id, page.id))
		.returning();
	await tx.insert(pageVersions).values({
		sourceId: newSourceId(),
		pageId: page.id,
		number: page.versionNumber + 1,
		...change,
		authorId: user.id,
		created: now,
		message: meta.message ?? null,
		minorEdit: meta.minorEdit ?? false,
	});
	return updated as PageRow;
}

export async function insertFirstVersion(
	tx: Executor,
	page: PageRow,
	user: CurrentUser,
	message: string | null,
) {
	await tx.insert(pageVersions).values({
		sourceId: newSourceId(),
		pageId: page.id,
		number: page.versionNumber,
		title: page.title,
		bodyStorage: page.bodyStorage,
		bodyHtml: page.bodyHtml,
		bodyDoc: page.bodyDoc,
		authorId: user.id,
		created: page.updated ?? new Date(),
		message,
	});
}

export async function loadVersion(
	ex: Executor,
	pageId: string,
	number: number,
) {
	const [row] = await ex
		.select()
		.from(pageVersions)
		.where(
			and(eq(pageVersions.pageId, pageId), eq(pageVersions.number, number)),
		)
		.limit(1);
	return row ?? fail(404, `Version ${number} not found`);
}
