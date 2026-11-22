import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import {
	asPermissionUser,
	type PermissionUser,
	type ViewerLike,
	visibleProjectIds,
} from "../permissions.ts";
import {
	filterFavourites,
	filterShares,
	filters,
	groups,
	users,
} from "../schema.ts";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const filterParams = z.object({ id: z.uuid() });

export const filterSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	jql: z.string(),
	columns: z.array(z.string()),
	shared: z.boolean(),
	owner: z.object({
		id: z.uuid(),
		username: z.string(),
		displayName: z.string(),
		avatarUrl: z.string().nullable(),
	}),
	favourite: z.boolean(),
	favouriteCount: z.number().int(),
	canEdit: z.boolean(),
	sharedWith: z
		.object({
			projectIds: z.array(z.uuid()),
			groups: z.array(z.string()),
		})
		.optional(),
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
});

export const bodySchema = z.object({
	name: z.string().trim().min(1).max(255),
	description: z.string().trim().max(2000).nullable().optional(),
	jql: z.string().trim().min(1).max(100_000),
	columns: z.array(z.string().min(1).max(200)).max(200).optional(),
	shared: z.boolean().optional(),
	sharedProjectIds: z.array(z.uuid()).max(200).optional(),
	sharedGroupIds: z.array(z.uuid()).max(200).optional(),
});

export const filterPatchSchema = bodySchema.partial();

export const listQuery = z.object({
	scope: z
		.enum(["visible", "mine", "favourite", "popular", "search"])
		.default("visible"),
	query: z.string().trim().max(200).default(""),
});

export const shareGroupSchema = z.object({ id: z.uuid(), name: z.string() });

export const favouriteSchema = z.object({
	favourite: z.boolean(),
	favouriteCount: z.number().int(),
});

type FilterRow = {
	id: string;
	name: string;
	description: string | null;
	jql: string;
	columns: unknown;
	shared: boolean;
	ownerId: string;
	ownerUsername: string;
	ownerDisplayName: string;
	ownerAvatarUrl: string | null;
	createdAt: Date;
	updatedAt: Date;
	favourite: number;
	favouriteCount: number;
	sharedProjects: string[];
	sharedGroups: string[];
	sharedGroupIds: string[];
};

function toFilter(row: FilterRow, viewerId: string, isAdmin: boolean) {
	const canEdit = row.ownerId === viewerId || isAdmin;
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		jql: row.jql,
		columns: Array.isArray(row.columns)
			? row.columns.filter((item): item is string => typeof item === "string")
			: [],
		shared: row.shared,
		owner: {
			id: row.ownerId,
			username: row.ownerUsername,
			displayName: row.ownerDisplayName,
			avatarUrl: row.ownerAvatarUrl,
		},
		favourite: Number(row.favourite) > 0,
		favouriteCount: Number(row.favouriteCount),
		canEdit,
		...(canEdit
			? {
					sharedWith: {
						projectIds: row.sharedProjects,
						groups: row.sharedGroups,
					},
				}
			: {}),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** Both counts come from the same table, so they are selected together. */
function favouriteColumns(viewerId: string) {
	return {
		favourite: sql<number>`(
			select count(*)::int from ${filterFavourites} f
			where f.filter_id = ${filters.id} and f.user_id = ${viewerId}
		)`,
		favouriteCount: sql<number>`(
			select count(*)::int from ${filterFavourites} f
			where f.filter_id = ${filters.id}
		)`,
	};
}

function filterColumns(viewerId: string) {
	return {
		id: filters.id,
		name: filters.name,
		description: filters.description,
		jql: filters.jql,
		columns: filters.columns,
		shared: filters.shared,
		ownerId: filters.ownerId,
		ownerUsername: users.username,
		ownerDisplayName: users.displayName,
		ownerAvatarUrl: userAvatarSql(users.id),
		createdAt: filters.createdAt,
		updatedAt: filters.updatedAt,
		sharedProjects: sql<string[]>`coalesce((
			select array_agg(fs.project_id::text)
			from filter_shares fs
			where fs.filter_id = ${filters.id} and fs.project_id is not null
		), '{}'::text[])`,
		sharedGroups: sql<string[]>`coalesce((
			select array_agg(g.name)
			from filter_shares fs
			join groups g on g.id = fs.group_id
			where fs.filter_id = ${filters.id} and fs.group_id is not null
		), '{}'::text[])`,
		sharedGroupIds: sql<string[]>`coalesce((
			select array_agg(fs.group_id::text)
			from filter_shares fs
			where fs.filter_id = ${filters.id} and fs.group_id is not null
		), '{}'::text[])`,
		...favouriteColumns(viewerId),
	};
}

function filterVisible(
	row: Pick<
		FilterRow,
		"ownerId" | "shared" | "sharedProjects" | "sharedGroups"
	>,
	user: PermissionUser,
	visible: string[],
) {
	if (user.isAdmin || row.ownerId === user.id || row.shared) return true;
	if (row.sharedProjects.some((id) => visible.includes(id))) return true;
	const ownGroups = new Set(user.groups.map((name) => name.toLowerCase()));
	return row.sharedGroups.some((name) => ownGroups.has(name.toLowerCase()));
}

type ShareVisibility = {
	projectIds: string[];
	groupIds: string[];
} | null;

/** The shares an editor may replace; `null` means every share (an administrator). */
async function visibleShareIds(user: PermissionUser): Promise<ShareVisibility> {
	if (user.isAdmin) return null;
	const projectIds = await visibleProjectIds(user);
	if (user.groups.length === 0) return { projectIds, groupIds: [] };
	const rows = await db
		.select({ id: groups.id })
		.from(groups)
		.where(
			sql`lower(${groups.name}) = any(${sql.param(user.groups.map((name) => name.toLowerCase()))}::text[])`,
		);
	return { projectIds, groupIds: rows.map((row) => row.id) };
}

/**
 * Replace only the shares the editor can see. A share to a project or group the
 * editor cannot see stays untouched, whatever list a client posts.
 */
async function replaceShares(
	tx: Transaction,
	filterId: string,
	projectIds: string[] | undefined,
	groupIds: string[] | undefined,
	visible: ShareVisibility,
) {
	// Two editors saving at once would otherwise merge their lists: the delete and
	// the insert of each must not interleave.
	await tx.execute(
		sql`select 1 from filters where id = ${filterId} for update`,
	);
	if (projectIds !== undefined) {
		await tx
			.delete(filterShares)
			.where(
				and(
					eq(filterShares.filterId, filterId),
					isNotNull(filterShares.projectId),
					visible
						? visible.projectIds.length > 0
							? inArray(filterShares.projectId, visible.projectIds)
							: sql`false`
						: undefined,
				),
			);
		const rows = [...new Set(projectIds)].map((projectId) => ({
			filterId,
			projectId,
		}));
		if (rows.length > 0) {
			await tx.insert(filterShares).values(rows).onConflictDoNothing();
		}
	}
	if (groupIds !== undefined) {
		await tx
			.delete(filterShares)
			.where(
				and(
					eq(filterShares.filterId, filterId),
					isNotNull(filterShares.groupId),
					visible
						? visible.groupIds.length > 0
							? inArray(filterShares.groupId, visible.groupIds)
							: sql`false`
						: undefined,
				),
			);
		const rows = [...new Set(groupIds)].map((groupId) => ({
			filterId,
			groupId,
		}));
		if (rows.length > 0) {
			await tx.insert(filterShares).values(rows).onConflictDoNothing();
		}
	}
}

async function loadShareIds(ex: Transaction, filterId: string) {
	const rows = await ex
		.select({
			projectId: filterShares.projectId,
			groupId: filterShares.groupId,
		})
		.from(filterShares)
		.where(eq(filterShares.filterId, filterId));
	return {
		projectIds: rows.flatMap((row) => (row.projectId ? [row.projectId] : [])),
		groupIds: rows.flatMap((row) => (row.groupId ? [row.groupId] : [])),
	};
}

/**
 * New shares must be within the editor's reach; shares already on the filter
 * stay valid so an old share cannot block an unrelated edit.
 */
async function validateShares(
	user: PermissionUser,
	projectIds: string[] | undefined,
	groupIds: string[] | undefined,
	existing: { projectIds: string[]; groupIds: string[] } = {
		projectIds: [],
		groupIds: [],
	},
	visible: ShareVisibility = null,
) {
	if (user.isAdmin) return null;

	if (projectIds && projectIds.length > 0) {
		const allowed = new Set([
			...(visible?.projectIds ?? []),
			...existing.projectIds,
		]);
		if (projectIds.some((id) => !allowed.has(id))) {
			return "You can only share this filter with projects you can browse";
		}
	}

	if (groupIds && groupIds.length > 0) {
		const allowed = new Set([
			...(visible?.groupIds ?? []),
			...existing.groupIds,
		]);
		if (groupIds.some((id) => !allowed.has(id))) {
			return "You can only share this filter with groups you are a member of";
		}
	}

	return null;
}

async function loadFilter(id: string, viewerId: string) {
	if (!filterParams.safeParse({ id }).success) return null;
	const [row] = await db
		.select(filterColumns(viewerId))
		.from(filters)
		.innerJoin(users, eq(users.id, filters.ownerId))
		.where(eq(filters.id, id))
		.limit(1);
	return row ?? null;
}

/** The trunk's single visibility rule, exported for the gadget data readers. */
export async function loadVisibleFilter(user: ViewerLike, id: string) {
	const row = await loadFilter(id, user.id);
	if (!row) return null;
	const permissionUser = asPermissionUser(user);
	const visible = await visibleProjectIds(permissionUser);
	return filterVisible(row, permissionUser, visible) ? row : null;
}

export async function listShareGroups(actor: CurrentUser) {
	return db
		.select({ id: groups.id, name: groups.name })
		.from(groups)
		.where(
			actor.isAdmin
				? undefined
				: sql`lower(${groups.name}) = any(${sql.param(actor.groups.map((name) => name.toLowerCase()))}::text[])`,
		)
		.orderBy(groups.name);
}

export async function listFilters(
	actor: ViewerLike,
	input: z.output<typeof listQuery>,
) {
	const { scope, query } = input;
	const actorGroups = actor.groups ?? [];
	const visibleProjects = await visibleProjectIds(asPermissionUser(actor));
	const visible = actor.isAdmin
		? undefined
		: or(
				eq(filters.shared, true),
				eq(filters.ownerId, actor.id),
				visibleProjects.length > 0
					? sql`exists (select 1 from filter_shares fs where fs.filter_id = ${filters.id} and fs.project_id = any(${sql.param(visibleProjects)}::uuid[]))`
					: undefined,
				actorGroups.length > 0
					? sql`exists (
						select 1 from filter_shares fs
						join groups g on g.id = fs.group_id
						where fs.filter_id = ${filters.id}
							and lower(g.name) = any(${sql.param(actorGroups.map((name) => name.toLowerCase()))}::text[])
					)`
					: undefined,
			);

	const scopeCondition =
		scope === "mine"
			? eq(filters.ownerId, actor.id)
			: scope === "favourite"
				? sql`exists (select 1 from ${filterFavourites} f where f.filter_id = ${filters.id} and f.user_id = ${actor.id})`
				: scope === "popular"
					? eq(filters.shared, true)
					: undefined;

	const searchCondition =
		scope === "search" && query !== ""
			? ilike(filters.name, `%${query.replace(/[%_\\]/g, "\\$&")}%`)
			: undefined;

	const rows = await db
		.select(filterColumns(actor.id))
		.from(filters)
		.innerJoin(users, eq(users.id, filters.ownerId))
		.where(and(visible, scopeCondition, searchCondition))
		.orderBy(
			scope === "popular"
				? desc(favouriteColumns(actor.id).favouriteCount)
				: desc(filters.updatedAt),
			filters.name,
		)
		.limit(200);

	return rows.map((row) => toFilter(row, actor.id, actor.isAdmin === true));
}

export type PageFilter = Omit<
	ReturnType<typeof toFilter>,
	"jql" | "columns" | "sharedWith" | "favouriteCount" | "createdAt"
> & {
	sharedSome: boolean;
	sharedWith?: {
		projectIds: string[];
		groups: string[];
		groupIds: string[];
	};
};

function toPageFilter(
	row: FilterRow,
	viewerId: string,
	isAdmin: boolean,
): PageFilter {
	const filter = toFilter(row, viewerId, isAdmin);
	const base = {
		id: filter.id,
		name: filter.name,
		description: filter.description,
		shared: filter.shared,
		owner: filter.owner,
		favourite: filter.favourite,
		canEdit: filter.canEdit,
		sharedSome: row.sharedProjects.length + row.sharedGroups.length > 0,
		updatedAt: filter.updatedAt,
	};
	if (!filter.canEdit) return base satisfies PageFilter;
	return {
		...base,
		sharedWith: {
			projectIds: row.sharedProjects,
			groups: row.sharedGroups,
			groupIds: row.sharedGroupIds,
		},
	} satisfies PageFilter;
}

/** The filter list for the page: an editor gets the share IDs, everyone else only the count. */
export async function listFiltersForPage(
	actor: CurrentUser,
	input: z.output<typeof listQuery>,
) {
	const { scope, query } = input;
	const visibleProjects = await visibleProjectIds(actor);
	const visible = actor.isAdmin
		? undefined
		: or(
				eq(filters.shared, true),
				eq(filters.ownerId, actor.id),
				visibleProjects.length > 0
					? sql`exists (select 1 from filter_shares fs where fs.filter_id = ${filters.id} and fs.project_id = any(${sql.param(visibleProjects)}::uuid[]))`
					: undefined,
				actor.groups.length > 0
					? sql`exists (
						select 1 from filter_shares fs
						join groups g on g.id = fs.group_id
						where fs.filter_id = ${filters.id}
							and lower(g.name) = any(${sql.param(actor.groups.map((name) => name.toLowerCase()))}::text[])
					)`
					: undefined,
			);
	const scopeCondition =
		scope === "mine"
			? eq(filters.ownerId, actor.id)
			: scope === "favourite"
				? sql`exists (select 1 from ${filterFavourites} f where f.filter_id = ${filters.id} and f.user_id = ${actor.id})`
				: scope === "popular"
					? eq(filters.shared, true)
					: undefined;
	const searchCondition =
		scope === "search" && query !== ""
			? ilike(filters.name, `%${query.replace(/[%_\\]/g, "\\$&")}%`)
			: undefined;

	const rows = await db
		.select(filterColumns(actor.id))
		.from(filters)
		.innerJoin(users, eq(users.id, filters.ownerId))
		.where(and(visible, scopeCondition, searchCondition))
		.orderBy(
			scope === "popular"
				? desc(favouriteColumns(actor.id).favouriteCount)
				: desc(filters.updatedAt),
			filters.name,
		)
		.limit(200);

	return rows.map((row) => toPageFilter(row, actor.id, actor.isAdmin));
}

export async function getFilter(actor: CurrentUser, id: string) {
	const row = await loadFilter(id, actor.id);
	if (!row) throw new HttpError(404, "Filter not found");
	const visibleProjects = await visibleProjectIds(actor);
	if (!filterVisible(row, actor, visibleProjects)) {
		throw new HttpError(404, "Filter not found");
	}

	return toFilter(row, actor.id, actor.isAdmin);
}

export async function createFilter(
	actor: CurrentUser,
	input: z.output<typeof bodySchema>,
) {
	if (!bodySchema.safeParse(input).success) {
		throw new HttpError(400, "Invalid filter");
	}
	const visible = await visibleShareIds(actor);
	const shareError = await validateShares(
		actor,
		input.sharedProjectIds,
		input.sharedGroupIds,
		undefined,
		visible,
	);
	if (shareError) throw new HttpError(400, shareError);

	const created = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(filters)
			.values({
				name: input.name,
				description: input.description ?? null,
				jql: input.jql,
				ownerId: actor.id,
				columns: input.columns ?? [],
				shared: input.shared ?? false,
			})
			.returning({ id: filters.id });
		if (!row) return null;
		await replaceShares(
			tx,
			row.id,
			input.sharedProjectIds,
			input.sharedGroupIds,
			visible,
		);
		return row;
	});
	const row = created ? await loadFilter(created.id, actor.id) : null;
	if (!row) throw new HttpError(400, "Filter was not created");

	return toFilter(row, actor.id, actor.isAdmin);
}

export async function updateFilter(
	actor: CurrentUser,
	id: string,
	body: z.output<typeof filterPatchSchema>,
) {
	if (!filterPatchSchema.safeParse(body).success) {
		throw new HttpError(400, "Invalid filter");
	}
	const row = await loadFilter(id, actor.id);
	if (!row) throw new HttpError(404, "Filter not found");
	if (row.ownerId !== actor.id && !actor.isAdmin) {
		throw new HttpError(
			403,
			"Only the owner or an administrator can change this filter",
		);
	}
	if (
		body.name === undefined &&
		body.description === undefined &&
		body.jql === undefined &&
		body.columns === undefined &&
		body.shared === undefined &&
		body.sharedProjectIds === undefined &&
		body.sharedGroupIds === undefined
	) {
		throw new HttpError(400, "Nothing to change");
	}
	const visible = await visibleShareIds(actor);

	const id2 = await db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(filters)
			.where(eq(filters.id, id))
			.for("update");
		if (!row) throw new HttpError(404, "Filter not found");
		if (row.ownerId !== actor.id && !actor.isAdmin) {
			throw new HttpError(
				403,
				"Only the owner or an administrator can change this filter",
			);
		}
		const existing = await loadShareIds(tx, row.id);
		const shareError = await validateShares(
			actor,
			body.sharedProjectIds,
			body.sharedGroupIds,
			existing,
			visible,
		);
		if (shareError) throw new HttpError(400, shareError);
		await tx
			.update(filters)
			.set({
				...(body.name === undefined ? {} : { name: body.name }),
				...(body.description === undefined
					? {}
					: { description: body.description }),
				...(body.jql === undefined ? {} : { jql: body.jql }),
				...(body.columns === undefined ? {} : { columns: body.columns }),
				...(body.shared === undefined ? {} : { shared: body.shared }),
				updatedAt: new Date(),
			})
			.where(eq(filters.id, row.id));
		await replaceShares(
			tx,
			row.id,
			body.sharedProjectIds,
			body.sharedGroupIds,
			visible,
		);
		return row.id;
	});

	const updated = await loadFilter(id2, actor.id);
	if (!updated) throw new HttpError(404, "Filter not found");
	return toFilter(updated, actor.id, actor.isAdmin);
}

export async function deleteFilter(actor: CurrentUser, id: string) {
	const row = await loadFilter(id, actor.id);
	if (!row) throw new HttpError(404, "Filter not found");
	if (row.ownerId !== actor.id && !actor.isAdmin) {
		throw new HttpError(
			403,
			"Only the owner or an administrator can delete this filter",
		);
	}

	await db.delete(filters).where(eq(filters.id, row.id));
}

export async function setFavourite(
	actor: CurrentUser,
	id: string,
	favourite: boolean,
) {
	const row = await loadFilter(id, actor.id);
	if (!row) throw new HttpError(404, "Filter not found");
	const visibleProjects = await visibleProjectIds(actor);
	if (!filterVisible(row, actor, visibleProjects)) {
		throw new HttpError(404, "Filter not found");
	}

	if (favourite) {
		await db
			.insert(filterFavourites)
			.values({ userId: actor.id, filterId: row.id })
			.onConflictDoNothing();
	} else {
		await db
			.delete(filterFavourites)
			.where(
				and(
					eq(filterFavourites.filterId, row.id),
					eq(filterFavourites.userId, actor.id),
				),
			);
	}

	const updated = await loadFilter(row.id, actor.id);
	return {
		favourite,
		favouriteCount: Number(updated?.favouriteCount ?? 0),
	};
}
