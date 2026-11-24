import { inArray, sql } from "drizzle-orm";
import { type CurrentUser, hasGroup } from "../auth.ts";
import { db } from "../db.ts";
import { spacePermissions, spaces } from "../schema.ts";

export interface WikiAccess {
	userId: string;
	isAdmin: boolean;
	/** Spaces the user may read. */
	readableSpaceIds: Set<string>;
	/** Pages the user may not read, including pages hidden by an ancestor. */
	hiddenPageIds: Set<string>;
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
 * administrators and space administrators see everything.
 */
export async function loadWikiAccess(
	user: CurrentUser,
	ex: Pick<typeof db, "select" | "execute"> = db,
): Promise<WikiAccess> {
	const [spaceRows, permissionRows] = await Promise.all([
		ex.select({ id: spaces.id }).from(spaces),
		ex
			.select({
				spaceId: spacePermissions.spaceId,
				permission: spacePermissions.permission,
				userId: spacePermissions.userId,
				groupName: spacePermissions.groupName,
				anonymous: spacePermissions.anonymous,
			})
			.from(spacePermissions)
			.where(inArray(spacePermissions.permission, ["read", "administer"])),
	]);
	const readableSpaceIds = new Set(spaceRows.map((row) => row.id));

	const readRowsBySpace = new Map<string, typeof permissionRows>();
	const administeredSpaceIds = new Set<string>();
	for (const row of permissionRows) {
		const list = readRowsBySpace.get(row.spaceId) ?? [];
		list.push(row);
		readRowsBySpace.set(row.spaceId, list);
		if (
			row.permission === "administer" &&
			(row.anonymous ||
				matchesUser(user, { userId: row.userId, groupName: row.groupName }))
		) {
			administeredSpaceIds.add(row.spaceId);
		}
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

		// Blocked pages and their descendants, resolved in the database so a
		// large page tree is never read into memory.
		const administered = [...administeredSpaceIds];
		const groups = user.groups.map((name) => name.toLowerCase());
		const hiddenRows = await ex.execute(sql`
			with recursive blocked as (
				select pr.page_id
				from page_restrictions pr
				left join pages p on p.id = pr.page_id
				where pr.operation = 'read'
					and not exists (
						select 1
						from page_restrictions own
						where own.page_id = pr.page_id
							and own.operation = 'read'
							and (
								(own.user_id is not null and own.user_id = ${user.id})
								or (
									own.user_id is null
									and own.group_name is not null
									and own.group_name <> ''
									and lower(own.group_name) = any(${sql.param(groups)}::text[])
								)
							)
					)
					and (p.space_id is null or p.space_id <> all(${sql.param(administered)}::uuid[]))
			),
			hidden as (
				select p.id, p.parent_id
				from pages p
				join blocked b on b.page_id = p.id
				where p.space_id <> all(${sql.param(administered)}::uuid[])
				union
				select p.id, p.parent_id
				from pages p
				join hidden h on p.parent_id = h.id
				where p.space_id <> all(${sql.param(administered)}::uuid[])
			)
			select id from hidden
		`);
		for (const row of hiddenRows.rows as { id: string }[]) {
			hiddenPageIds.add(row.id);
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
