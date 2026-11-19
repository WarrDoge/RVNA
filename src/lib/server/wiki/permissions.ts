import { eq, inArray } from "drizzle-orm";
import { type CurrentUser, hasGroup } from "../auth.ts";
import { db } from "../db.ts";
import {
	pageRestrictions,
	pages,
	spacePermissions,
	spaces,
} from "../schema.ts";

export interface WikiAccess {
	userId: string;
	isAdmin: boolean;
	/** Spaces the user may read. */
	readableSpaceIds: Set<string>;
	/** Pages the user may not read, including pages hidden by an ancestor. */
	hiddenPageIds: Set<string>;
}

interface RestrictionRow {
	pageId: string;
	userId: string | null;
	groupName: string | null;
}

function matchesUser(
	user: { id: string; groups: string[] },
	row: { userId: string | null; groupName: string | null },
) {
	if (row.userId) return row.userId === user.id;
	if (row.groupName) return hasGroup(user, row.groupName);
	return false;
}

/**
 * Loads everything a request needs to enforce wiki read access.
 *
 * A space is readable when one of its read rows names the user, one of the
 * user's groups, or anonymous; an administer row counts as a read row. A space
 * without any such row is readable by administrators only, as in Confluence. A
 * page is readable when its space is readable and neither the page nor any
 * ancestor has a read restriction that excludes the user. Application
 * administrators see everything.
 */
export async function loadWikiAccess(user: CurrentUser): Promise<WikiAccess> {
	const spaceRows = await db.select({ id: spaces.id }).from(spaces);
	const readableSpaceIds = new Set(spaceRows.map((row) => row.id));

	const permissionRows = await db
		.select({
			spaceId: spacePermissions.spaceId,
			userId: spacePermissions.userId,
			groupName: spacePermissions.groupName,
			anonymous: spacePermissions.anonymous,
		})
		.from(spacePermissions)
		.where(inArray(spacePermissions.permission, ["read", "administer"]));

	const readRowsBySpace = new Map<string, typeof permissionRows>();
	for (const row of permissionRows) {
		const list = readRowsBySpace.get(row.spaceId) ?? [];
		list.push(row);
		readRowsBySpace.set(row.spaceId, list);
	}

	const hiddenPageIds = new Set<string>();
	if (!user.isAdmin) {
		for (const spaceId of spaceRows.map((row) => row.id)) {
			const allowed = (readRowsBySpace.get(spaceId) ?? []).some(
				(row) =>
					row.anonymous ||
					matchesUser(user, { userId: row.userId, groupName: row.groupName }),
			);
			if (!allowed) readableSpaceIds.delete(spaceId);
		}

		const restrictions = (await db
			.select({
				pageId: pageRestrictions.pageId,
				userId: pageRestrictions.userId,
				groupName: pageRestrictions.groupName,
			})
			.from(pageRestrictions)
			.where(eq(pageRestrictions.operation, "read"))) as RestrictionRow[];

		const restrictedPages = new Map<string, RestrictionRow[]>();
		for (const row of restrictions) {
			const list = restrictedPages.get(row.pageId) ?? [];
			list.push(row);
			restrictedPages.set(row.pageId, list);
		}

		if (restrictedPages.size > 0) {
			const pageRows = await db
				.select({ id: pages.id, parentId: pages.parentId })
				.from(pages);
			const children = new Map<string | null, string[]>();
			for (const row of pageRows) {
				const list = children.get(row.parentId) ?? [];
				list.push(row.id);
				children.set(row.parentId, list);
			}

			const blocked: string[] = [];
			for (const [pageId, rows] of restrictedPages) {
				if (!rows.some((row) => matchesUser(user, row))) blocked.push(pageId);
			}

			const queue = [...blocked];
			while (queue.length > 0) {
				const pageId = queue.shift() as string;
				if (hiddenPageIds.has(pageId)) continue;
				hiddenPageIds.add(pageId);
				queue.push(...(children.get(pageId) ?? []));
			}
		}
	}

	return {
		userId: user.id,
		isAdmin: user.isAdmin,
		readableSpaceIds,
		hiddenPageIds,
	};
}

export function spaceReadable(access: WikiAccess, spaceId: string) {
	return access.readableSpaceIds.has(spaceId);
}

export function pageReadable(
	access: WikiAccess,
	page: { id: string; spaceId: string },
) {
	return (
		spaceReadable(access, page.spaceId) && !access.hiddenPageIds.has(page.id)
	);
}

export function canManageComment(
	user: CurrentUser,
	comment: { authorId: string | null },
) {
	return (
		user.isAdmin || (comment.authorId !== null && comment.authorId === user.id)
	);
}
