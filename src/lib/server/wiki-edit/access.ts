import { and, eq, inArray, or, sql } from "drizzle-orm";
import { type CurrentUser, hasGroup } from "../auth.ts";
import { db } from "../db.ts";
import { pageRestrictions, spacePermissions, spaces } from "../schema.ts";
import {
	loadWikiAccess,
	pageReadable,
	spaceReadable,
	type WikiAccess,
} from "../wiki/permissions.ts";
import { allow, type Executor, fail, type PageRow } from "./common.ts";

export const SPACE_PERMISSIONS = [
	"read",
	"create",
	"export",
	"delete_own",
	"delete",
	"restrict",
	"delete_mail",
	"administer",
] as const;
export type SpacePermission = (typeof SPACE_PERMISSIONS)[number];
export type Grants = ReadonlySet<string>;

const everything: Grants = new Set(SPACE_PERMISSIONS);

/** administer implies every other permission of its space. */
export const can = (grants: Grants, permission: SpacePermission) =>
	grants.has("administer") || grants.has(permission);

const appliesTo = (user: CurrentUser) =>
	or(
		eq(spacePermissions.anonymous, true),
		eq(spacePermissions.userId, user.id),
		user.groups.length > 0
			? sql`lower(${spacePermissions.groupName}) = any(${sql.param(user.groups.map((name) => name.toLowerCase()))}::text[])`
			: undefined,
	);

export async function spaceGrants(
	user: CurrentUser,
	spaceId: string,
	ex: Executor = db,
): Promise<Grants> {
	if (user.isAdmin) return everything;
	const rows = await ex
		.select({ permission: spacePermissions.permission })
		.from(spacePermissions)
		.where(and(eq(spacePermissions.spaceId, spaceId), appliesTo(user)));
	return new Set(rows.map((row) => row.permission));
}

/** Grants per space id for every space the user has any permission in; null for an app admin (all). */
export async function allSpaceGrants(
	user: CurrentUser,
): Promise<Map<string, Set<string>> | null> {
	if (user.isAdmin) return null;
	const rows = await db
		.select({
			spaceId: spacePermissions.spaceId,
			permission: spacePermissions.permission,
		})
		.from(spacePermissions)
		.where(appliesTo(user));
	const grants = new Map<string, Set<string>>();
	for (const row of rows) {
		const set = grants.get(row.spaceId) ?? new Set<string>();
		set.add(row.permission);
		grants.set(row.spaceId, set);
	}
	return grants;
}

export const grantsFor = (
	all: Map<string, Set<string>> | null,
	spaceId: string,
): Grants => (all === null ? everything : (all.get(spaceId) ?? new Set()));

/** Of the given pages, those the user may update according to the update restrictions on the page itself. */
export async function updateAllowed(
	user: CurrentUser,
	ids: string[],
	ex: Executor = db,
): Promise<Set<string>> {
	const allowed = new Set(ids);
	if (ids.length === 0) return allowed;
	const rows = await ex
		.select({
			pageId: pageRestrictions.pageId,
			userId: pageRestrictions.userId,
			groupName: pageRestrictions.groupName,
		})
		.from(pageRestrictions)
		.where(
			and(
				inArray(pageRestrictions.pageId, ids),
				eq(pageRestrictions.operation, "update"),
			),
		);
	const restricted = new Set<string>();
	const listed = new Set<string>();
	for (const row of rows) {
		restricted.add(row.pageId);
		if (
			row.userId === user.id ||
			(row.groupName !== null && hasGroup(user, row.groupName))
		) {
			listed.add(row.pageId);
		}
	}
	for (const id of restricted) {
		if (!listed.has(id)) allowed.delete(id);
	}
	return allowed;
}

export type PageAccess = {
	read: boolean;
	edit: boolean;
	trash: boolean;
	restrict: boolean;
	administer: boolean;
	/** app admin or space admin: page restrictions do not apply */
	bypass: boolean;
	/** The space is archived: nobody changes its content until it is unarchived. */
	archived: boolean;
	grants: Grants;
};

const ARCHIVED = "This space is archived and read only";

export const spaceArchived = async (spaceId: string, ex: Executor = db) => {
	const [space] = await ex
		.select({ status: spaces.status })
		.from(spaces)
		.where(eq(spaces.id, spaceId))
		.limit(1);
	return space?.status === "archived";
};

type AccessPage = Pick<PageRow, "id" | "spaceId" | "creatorId" | "status">;

export async function pageAccess(
	user: CurrentUser,
	page: AccessPage,
	wiki?: WikiAccess,
	ex: Executor = db,
): Promise<PageAccess> {
	// One after the other: inside a transaction both run on its single connection.
	const grants = await spaceGrants(user, page.spaceId, ex);
	const archived = await spaceArchived(page.spaceId, ex);
	const bypass = grants.has("administer");
	const hidden =
		page.status === "draft" && !user.isAdmin && page.creatorId !== user.id;
	const read =
		!hidden &&
		(bypass || pageReadable(wiki ?? (await loadWikiAccess(user, ex)), page));
	const update =
		bypass || (await updateAllowed(user, [page.id], ex)).has(page.id);
	const own = page.creatorId === user.id;
	const write = read && update && !archived;
	return {
		read,
		edit: write && can(grants, "create"),
		trash:
			write && (can(grants, "delete") || (can(grants, "delete_own") && own)),
		restrict: write && can(grants, "restrict"),
		administer: grants.has("administer"),
		bypass,
		archived,
		grants,
	};
}

export async function requireAccess(
	user: CurrentUser,
	page: AccessPage,
	need: "read" | "edit" | "trash" | "restrict" | "administer",
	wiki?: WikiAccess,
	ex?: Executor,
): Promise<PageAccess> {
	const access = await pageAccess(user, page, wiki, ex);
	if (!access.read) fail(404, "Page not found");
	if (need !== "read") allow(!access.archived, ARCHIVED);
	allow(access[need]);
	return access;
}

/** A space the user may not read is answered like one that does not exist. */
const spaceNotFound = () => fail(404, "Space not found");

export async function requireReadableSpace(
	user: CurrentUser,
	spaceId: string,
	wiki?: WikiAccess,
): Promise<WikiAccess> {
	const access = wiki ?? (await loadWikiAccess(user));
	if (!spaceReadable(access, spaceId)) spaceNotFound();
	return access;
}

/** The permissions that change the content of a space; an archived space refuses them. */
const CONTENT_PERMISSIONS: readonly SpacePermission[] = [
	"create",
	"delete_own",
	"delete",
	"restrict",
	"delete_mail",
];

/** Throws 403 when the space is archived. */
export function assertNotArchived(space: { status: string }) {
	allow(space.status !== "archived", ARCHIVED);
}

export async function requireGrant(
	user: CurrentUser,
	spaceId: string,
	need: SpacePermission,
	ex?: Executor,
): Promise<Grants> {
	const grants = await spaceGrants(user, spaceId, ex);
	if (!can(grants, "read")) spaceNotFound();
	allow(can(grants, need));
	if (CONTENT_PERMISSIONS.includes(need)) {
		allow(!(await spaceArchived(spaceId, ex)), ARCHIVED);
	}
	return grants;
}
