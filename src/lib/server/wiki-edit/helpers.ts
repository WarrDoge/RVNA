import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { CurrentUser } from "../auth.ts";
import { pageLabels, pages } from "../schema-wiki.ts";
import { requireAccess } from "./access.ts";
import {
	type Executor,
	fail,
	loadPage,
	newSourceId,
	type PageRow,
	pgCode,
	pgConstraint,
	type SpaceRow,
} from "./common.ts";

/** The same answer whether the page that holds the title is one the caller may read or not. */
const titleTaken = (title: string): never =>
	fail(
		409,
		`The title "${title}" is not available in this space. Choose another title.`,
	);

export async function assertTitleFree(
	ex: Executor,
	spaceId: string,
	title: string,
	exceptId?: string,
) {
	const [clash] = await ex
		.select({ id: pages.id })
		.from(pages)
		.where(
			and(
				eq(pages.spaceId, spaceId),
				eq(pages.title, title),
				eq(pages.status, "current"),
				exceptId ? ne(pages.id, exceptId) : undefined,
			),
		)
		.limit(1);
	if (clash) titleTaken(title);
}

/** Maps the unique-title violation of a racing write to 409. */
export async function titleClash<T>(title: string, run: () => Promise<T>) {
	try {
		return await run();
	} catch (error) {
		if (
			pgCode(error) === "23505" &&
			pgConstraint(error) === "pages_space_title_current_unique"
		) {
			titleTaken(title);
		}
		throw error;
	}
}

const siblingFilter = (spaceId: string, parentId: string | null) =>
	and(
		eq(pages.spaceId, spaceId),
		parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId),
		eq(pages.status, "current"),
	);

export async function siblingIds(
	ex: Executor,
	spaceId: string,
	parentId: string | null,
	exceptId?: string,
): Promise<string[]> {
	const rows = await ex
		.select({ id: pages.id })
		.from(pages)
		.where(
			and(
				siblingFilter(spaceId, parentId),
				exceptId ? ne(pages.id, exceptId) : undefined,
			),
		)
		.orderBy(asc(pages.position), asc(pages.title), asc(pages.id));
	return rows.map((row) => row.id);
}

/**
 * Serializes the writers that pick a position among one set of siblings (create,
 * copy and move). An advisory lock keyed by the parent, or the space root, avoids
 * row-locking pages that another move may be moving, which could deadlock.
 * Must run inside a transaction: the lock is released when that transaction ends.
 */
export async function lockSiblings(
	ex: Executor,
	spaceId: string,
	parentId: string | null,
) {
	await ex.execute(
		sql`select pg_advisory_xact_lock(hashtext(${`rvna.wiki.siblings:${spaceId}:${parentId ?? "root"}`}))`,
	);
}

export async function nextPosition(
	ex: Executor,
	spaceId: string,
	parentId: string | null,
): Promise<number> {
	const [row] = await ex
		.select({ next: sql<number>`coalesce(max(${pages.position}) + 1, 0)` })
		.from(pages)
		.where(siblingFilter(spaceId, parentId));
	return Number(row?.next ?? 0);
}

/** Sets position 0..n-1 in the given order. */
export async function setPositions(ex: Executor, orderedIds: string[]) {
	if (orderedIds.length === 0) return;
	const rows = orderedIds.map((id, pos) => ({ id, pos }));
	await ex.execute(sql`
		update pages set position = t.pos
		from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as t(id uuid, pos int)
		where pages.id = t.id and pages.position is distinct from t.pos`);
}

/** Ids of every page below `rootId`, whatever their status. */
export async function descendantIds(
	ex: Executor,
	rootId: string,
): Promise<string[]> {
	const { rows } = await ex.execute(sql`
		with recursive d(id) as (
			select id from pages where parent_id = ${rootId}
			union
			select p.id from pages p join d on p.parent_id = d.id
		)
		select id from d`);
	return (rows as { id: string }[]).map((row) => row.id);
}

/** A parent must be a current page of the space the user can read. */
export async function checkParent(
	ex: Executor,
	user: CurrentUser,
	space: SpaceRow,
	parentId: string | null,
): Promise<PageRow | null> {
	if (!parentId) return null;
	const { page } = await loadPage(ex, parentId);
	await requireAccess(user, page, "read", undefined, ex);
	if (page.spaceId !== space.id || page.status !== "current") {
		fail(400, "Parent page is not a current page of this space");
	}
	return page;
}

export async function setLabels(
	tx: Executor,
	pageId: string,
	labels: string[],
) {
	const wanted = [...new Set(labels)];
	const existing = await tx
		.select({ label: pageLabels.label })
		.from(pageLabels)
		.where(eq(pageLabels.pageId, pageId));
	const keep = new Set(wanted);
	const have = new Set(existing.map((row) => row.label));
	const remove = [...have].filter((label) => !keep.has(label));
	if (remove.length > 0) {
		await tx
			.delete(pageLabels)
			.where(
				and(eq(pageLabels.pageId, pageId), inArray(pageLabels.label, remove)),
			);
	}
	const add = wanted.filter((label) => !have.has(label));
	if (add.length > 0) {
		await tx
			.insert(pageLabels)
			.values(add.map((label) => ({ sourceId: newSourceId(), pageId, label })))
			.onConflictDoNothing({
				target: [pageLabels.pageId, pageLabels.label],
			});
	}
}

/** Ancestors of a page, nearest first (the page itself is not included). */
export async function ancestors(
	ex: Executor,
	pageId: string,
): Promise<{ id: string; title: string }[]> {
	const { rows } = await ex.execute(sql`
		with recursive chain(id, parent_id, depth) as (
			select id, parent_id, 0 from pages where id = ${pageId}
			union
			select p.id, p.parent_id, c.depth + 1 from pages p
			join chain c on p.id = c.parent_id where c.depth < 100
		)
		select p.id, p.title from chain c join pages p on p.id = c.id
		where c.depth > 0 order by c.depth`);
	return rows as { id: string; title: string }[];
}
