import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
	type DashboardLayout,
	isSafeLinkUrl,
	layoutColumns,
} from "../../shared/gadgets.ts";
import type { CurrentUser } from "../auth.ts";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import { loadGadgetData } from "../gadget-data.ts";
import { sanitizeBodyHtml } from "../html.ts";
import { HttpError } from "../http.ts";
import {
	dashboardFavourites,
	dashboardGadgets,
	dashboards,
	users,
} from "../schema.ts";
import type {
	CreateDashboardBody,
	DashboardDetail,
	DashboardSummary,
	FavouriteResult,
	GadgetBody,
	GadgetPatchBody,
	GadgetRow,
	LayoutBody,
	ListQuery,
	PatchDashboardBody,
} from "./schemas.ts";

const statisticSchema = z.enum([
	"status",
	"priority",
	"type",
	"assignee",
	"reporter",
	"project",
	"resolution",
	"component",
	"label",
	"fixVersion",
]);

const columnsSchema = z.array(z.string().min(1).max(200)).max(50);

const configSchemas = {
	"filter-results": z.object({
		filterId: z.uuid().nullable().default(null),
		columns: columnsSchema.default([]),
		rows: z.number().int().min(1).max(100).default(10),
	}),
	"assigned-to-me": z.object({
		columns: columnsSchema.default([]),
		rows: z.number().int().min(1).max(100).default(10),
	}),
	"watched-issues": z.object({
		columns: columnsSchema.default([]),
		rows: z.number().int().min(1).max(100).default(10),
		showResolved: z.boolean().default(true),
	}),
	"activity-stream": z.object({
		projects: z.array(z.string().min(1).max(32)).max(20).default([]),
		users: z.array(z.string().min(1).max(128)).max(20).default([]),
		days: z.number().int().min(1).max(90).default(7),
		rows: z.number().int().min(1).max(100).default(10),
	}),
	"pie-chart": z.object({
		statistic: statisticSchema.default("status"),
		filterId: z.uuid().nullable().default(null),
		project: z.string().min(1).max(32).nullable().default(null),
	}),
	"issue-statistics": z.object({
		statistic: statisticSchema.default("status"),
		filterId: z.uuid().nullable().default(null),
		project: z.string().min(1).max(32).nullable().default(null),
	}),
	"two-dimensional": z
		.object({
			xStatistic: statisticSchema.default("status"),
			yStatistic: statisticSchema.default("priority"),
			filterId: z.uuid().nullable().default(null),
			project: z.string().min(1).max(32).nullable().default(null),
		})
		.refine((config) => config.xStatistic !== config.yStatistic, {
			message: "Choose two different statistics",
			path: ["yStatistic"],
		}),
	"created-vs-resolved": z.object({
		filterId: z.uuid().nullable().default(null),
		project: z.string().min(1).max(32).nullable().default(null),
		days: z.number().int().min(2).max(120).default(30),
	}),
	introduction: z.object({
		html: z.string().max(20_000).default(""),
	}),
	"favourite-filters": z.object({}),
	"quick-links": z.object({
		links: z
			.array(
				z.object({
					title: z.string().trim().min(1).max(200),
					url: z
						.string()
						.trim()
						.min(1)
						.max(2000)
						.refine(
							isSafeLinkUrl,
							"Use an http, https or mailto URL, or a path on this site",
						),
				}),
			)
			.max(50)
			.default([]),
	}),
} as const;

type ConfigType = keyof typeof configSchemas;

/** Unknown gadget types are imported as they are and render a neutral box. */
export async function normalizeConfig(type: string, config: unknown) {
	const schema = configSchemas[type as ConfigType];
	if (!schema) return (config ?? {}) as Record<string, unknown>;
	const parsed = schema.safeParse(config ?? {});
	if (!parsed.success) return null;
	const values = parsed.data as Record<string, unknown>;
	if (type === "introduction") {
		values.html =
			(await sanitizeBodyHtml(
				typeof values.html === "string" ? values.html : "",
			)) ?? "";
	}
	return values;
}

export function defaultConfig(type: string) {
	const schema = configSchemas[type as ConfigType];
	if (!schema) return {};
	return schema.parse({}) as Record<string, unknown>;
}

type DashboardRow = {
	id: string;
	sourceId: string | null;
	name: string;
	description: string | null;
	layout: string;
	shared: boolean;
	ownerId: string;
	ownerUsername: string;
	ownerDisplayName: string;
	ownerAvatarUrl: string | null;
	favourite: number;
	favouriteCount: number;
	gadgetCount: number;
	createdAt: Date;
	updatedAt: Date;
};

function toSummary(row: DashboardRow, viewerId: string, isAdmin: boolean) {
	return {
		id: row.id,
		sourceId: row.sourceId,
		name: row.name,
		description: row.description,
		layout: row.layout,
		shared: row.shared,
		owner: {
			id: row.ownerId,
			username: row.ownerUsername,
			displayName: row.ownerDisplayName,
			avatarUrl: row.ownerAvatarUrl,
		},
		favourite: Number(row.favourite) > 0,
		favouriteCount: Number(row.favouriteCount),
		gadgetCount: Number(row.gadgetCount),
		canEdit: row.ownerId === viewerId || isAdmin,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function summaryColumns(viewerId: string) {
	return {
		id: dashboards.id,
		sourceId: dashboards.sourceId,
		name: dashboards.name,
		description: dashboards.description,
		layout: dashboards.layout,
		shared: dashboards.shared,
		ownerId: dashboards.ownerId,
		ownerUsername: users.username,
		ownerDisplayName: users.displayName,
		ownerAvatarUrl: userAvatarSql(users.id),
		createdAt: dashboards.createdAt,
		updatedAt: dashboards.updatedAt,
		favourite: sql<number>`(
			select count(*)::int from ${dashboardFavourites} f
			where f.dashboard_id = ${dashboards.id} and f.user_id = ${viewerId}
		)`,
		favouriteCount: sql<number>`(
			select count(*)::int from ${dashboardFavourites} f
			where f.dashboard_id = ${dashboards.id}
		)`,
		gadgetCount: sql<number>`(
			select count(*)::int from ${dashboardGadgets} g
			where g.dashboard_id = ${dashboards.id}
		)`,
	};
}

function visibleTo(user: { id: string; isAdmin: boolean }) {
	return user.isAdmin
		? undefined
		: or(eq(dashboards.shared, true), eq(dashboards.ownerId, user.id));
}

async function loadDashboardRow(idOrSourceId: string, viewerId: string) {
	const condition = z.uuid().safeParse(idOrSourceId).success
		? eq(dashboards.id, idOrSourceId)
		: eq(dashboards.sourceId, idOrSourceId);
	const [row] = await db
		.select(summaryColumns(viewerId))
		.from(dashboards)
		.innerJoin(users, eq(users.id, dashboards.ownerId))
		.where(condition)
		.limit(1);
	return row ?? null;
}

async function loadGadgets(dashboardId: string) {
	const rows = await db
		.select()
		.from(dashboardGadgets)
		.where(eq(dashboardGadgets.dashboardId, dashboardId))
		.orderBy(asc(dashboardGadgets.columnIndex), asc(dashboardGadgets.rowIndex));
	return rows.map((row) => ({
		id: row.id,
		sourceId: row.sourceId,
		type: row.type,
		title: row.title,
		column: row.columnIndex,
		row: row.rowIndex,
		color: row.color,
		refreshSeconds: row.refreshSeconds,
		config: (row.config ?? {}) as Record<string, unknown>,
	}));
}

export async function loadDashboard(
	idOrSourceId: string,
	user: { id: string; isAdmin: boolean },
) {
	const row = await loadDashboardRow(idOrSourceId, user.id);
	if (!row) return null;
	if (!row.shared && row.ownerId !== user.id && !user.isAdmin) return null;
	return {
		...toSummary(row, user.id, user.isAdmin),
		gadgets: await loadGadgets(row.id),
	};
}

async function canEditDashboard(
	idOrSourceId: string,
	user: { id: string; isAdmin: boolean },
) {
	const row = await loadDashboardRow(idOrSourceId, user.id);
	if (!row) return { status: "missing" as const, row: null };
	if (!row.shared && row.ownerId !== user.id && !user.isAdmin) {
		return { status: "missing" as const, row };
	}
	if (row.ownerId !== user.id && !user.isAdmin) {
		return { status: "forbidden" as const, row };
	}
	return { status: "ok" as const, row };
}

export async function listDashboards(
	actor: CurrentUser,
	input: ListQuery,
): Promise<DashboardSummary[]> {
	const { scope, query } = input;
	const scopeCondition =
		scope === "mine"
			? eq(dashboards.ownerId, actor.id)
			: scope === "favourite"
				? sql`exists (select 1 from ${dashboardFavourites} f where f.dashboard_id = ${dashboards.id} and f.user_id = ${actor.id})`
				: undefined;
	const searchCondition =
		scope === "search" && query !== ""
			? ilike(dashboards.name, `%${query.replace(/[%_\\]/g, "\\$&")}%`)
			: undefined;

	const rows = await db
		.select(summaryColumns(actor.id))
		.from(dashboards)
		.innerJoin(users, eq(users.id, dashboards.ownerId))
		.where(and(visibleTo(actor), scopeCondition, searchCondition))
		.orderBy(
			scope === "popular"
				? desc(
						sql`(select count(*) from ${dashboardFavourites} f where f.dashboard_id = ${dashboards.id})`,
					)
				: asc(dashboards.name),
		)
		.limit(200);

	return rows.map((row) => toSummary(row, actor.id, actor.isAdmin));
}

export async function defaultDashboard(
	actor: CurrentUser,
): Promise<DashboardDetail> {
	const [favourite] = await db
		.select({ id: dashboards.id })
		.from(dashboardFavourites)
		.innerJoin(dashboards, eq(dashboards.id, dashboardFavourites.dashboardId))
		.where(and(eq(dashboardFavourites.userId, actor.id), visibleTo(actor)))
		.orderBy(asc(dashboardFavourites.createdAt))
		.limit(1);

	const [system] = favourite
		? []
		: await db
				.select({ id: dashboards.id })
				.from(dashboards)
				.where(and(eq(dashboards.name, "System Dashboard"), visibleTo(actor)))
				.limit(1);

	const [first] =
		favourite || system
			? []
			: await db
					.select({ id: dashboards.id })
					.from(dashboards)
					.where(visibleTo(actor))
					.orderBy(asc(dashboards.name))
					.limit(1);

	const id = favourite?.id ?? system?.id ?? first?.id;
	if (!id) throw new HttpError(404, "No dashboard");

	const dashboard = await loadDashboard(id, actor);
	if (!dashboard) throw new HttpError(404, "No dashboard");
	return dashboard;
}

export async function getDashboard(
	actor: CurrentUser,
	id: string,
): Promise<DashboardDetail> {
	const dashboard = await loadDashboard(id, actor);
	if (!dashboard) throw new HttpError(404, "Dashboard not found");
	return dashboard;
}

export async function createDashboard(
	actor: CurrentUser,
	body: CreateDashboardBody,
): Promise<DashboardDetail> {
	let copy: {
		id: string;
		layout: string;
		description: string | null;
	} | null = null;
	if (body.copyOf) {
		const source = await loadDashboard(body.copyOf, actor);
		if (!source) throw new HttpError(404, "Dashboard not found");
		copy = {
			id: source.id,
			layout: source.layout,
			description: source.description,
		};
	}

	const created = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(dashboards)
			.values({
				name: body.name,
				description: body.description ?? copy?.description ?? null,
				ownerId: actor.id,
				layout: (body.layout ?? copy?.layout ?? "AA") as
					| "A"
					| "AA"
					| "AB"
					| "BA"
					| "AAA",
				shared: body.shared ?? false,
			})
			.returning({ id: dashboards.id });
		if (!row) return null;

		// Jira puts a dashboard you create or copy in your favourites.
		await tx
			.insert(dashboardFavourites)
			.values({ userId: actor.id, dashboardId: row.id })
			.onConflictDoNothing();

		if (copy) {
			const gadgets = await tx
				.select()
				.from(dashboardGadgets)
				.where(eq(dashboardGadgets.dashboardId, copy.id));
			const copied: (typeof dashboardGadgets.$inferInsert)[] = [];
			for (const gadget of gadgets) {
				const config =
					(await normalizeConfig(gadget.type, gadget.config)) ??
					defaultConfig(gadget.type);
				copied.push({
					dashboardId: row.id,
					type: gadget.type,
					title: gadget.title,
					columnIndex: gadget.columnIndex,
					rowIndex: gadget.rowIndex,
					color: gadget.color,
					refreshSeconds: gadget.refreshSeconds,
					config,
				});
			}
			if (copied.length > 0) {
				await tx.insert(dashboardGadgets).values(copied);
			}
		}
		return row;
	});

	if (!created) throw new HttpError(400, "Dashboard was not created");
	const dashboard = await loadDashboard(created.id, actor);
	if (!dashboard) throw new HttpError(400, "Dashboard was not created");
	return dashboard;
}

export async function updateDashboard(
	actor: CurrentUser,
	id: string,
	body: PatchDashboardBody,
): Promise<DashboardDetail> {
	const access = await canEditDashboard(id, actor);
	if (access.status === "missing")
		throw new HttpError(404, "Dashboard not found");
	if (access.status === "forbidden") {
		throw new HttpError(
			403,
			"Only the owner or an administrator can change this dashboard",
		);
	}

	if (
		body.name === undefined &&
		body.description === undefined &&
		body.layout === undefined &&
		body.shared === undefined
	) {
		throw new HttpError(400, "Nothing to change");
	}

	await db
		.update(dashboards)
		.set({
			...(body.name === undefined ? {} : { name: body.name }),
			...(body.description === undefined
				? {}
				: { description: body.description }),
			...(body.layout === undefined ? {} : { layout: body.layout }),
			...(body.shared === undefined ? {} : { shared: body.shared }),
			updatedAt: new Date(),
		})
		.where(eq(dashboards.id, access.row.id));

	const dashboard = await loadDashboard(access.row.id, actor);
	if (!dashboard) throw new HttpError(404, "Dashboard not found");
	return dashboard;
}

export async function removeDashboard(actor: CurrentUser, id: string) {
	const access = await canEditDashboard(id, actor);
	if (access.status === "missing")
		throw new HttpError(404, "Dashboard not found");
	if (access.status === "forbidden") {
		throw new HttpError(
			403,
			"Only the owner or an administrator can delete this dashboard",
		);
	}

	await db.delete(dashboards).where(eq(dashboards.id, access.row.id));
}

export async function favouriteDashboard(
	actor: CurrentUser,
	id: string,
): Promise<FavouriteResult> {
	const row = await loadDashboardRow(id, actor.id);
	if (!row || (!row.shared && row.ownerId !== actor.id && !actor.isAdmin)) {
		throw new HttpError(404, "Dashboard not found");
	}

	await db
		.insert(dashboardFavourites)
		.values({ userId: actor.id, dashboardId: row.id })
		.onConflictDoNothing();

	const updated = await loadDashboardRow(row.id, actor.id);
	return {
		favourite: true,
		favouriteCount: Number(updated?.favouriteCount ?? 0),
	};
}

export async function unfavouriteDashboard(
	actor: CurrentUser,
	id: string,
): Promise<FavouriteResult> {
	const row = await loadDashboardRow(id, actor.id);
	if (!row || (!row.shared && row.ownerId !== actor.id && !actor.isAdmin)) {
		throw new HttpError(404, "Dashboard not found");
	}

	await db
		.delete(dashboardFavourites)
		.where(
			and(
				eq(dashboardFavourites.dashboardId, row.id),
				eq(dashboardFavourites.userId, actor.id),
			),
		);

	const updated = await loadDashboardRow(row.id, actor.id);
	return {
		favourite: false,
		favouriteCount: Number(updated?.favouriteCount ?? 0),
	};
}

export async function addGadget(
	actor: CurrentUser,
	id: string,
	body: GadgetBody,
): Promise<GadgetRow> {
	const access = await canEditDashboard(id, actor);
	if (access.status === "missing")
		throw new HttpError(404, "Dashboard not found");
	if (access.status === "forbidden") {
		throw new HttpError(
			403,
			"Only the owner or an administrator can add gadgets",
		);
	}

	if (
		body.type === "introduction" &&
		body.config !== undefined &&
		!actor.isAdmin
	) {
		throw new HttpError(
			403,
			"Only an administrator can write the introduction",
		);
	}

	const config = await normalizeConfig(
		body.type,
		body.config ?? defaultConfig(body.type),
	);
	if (!config) throw new HttpError(400, "Invalid gadget configuration");

	const row = await db.transaction(async (tx) => {
		const placement =
			body.column === undefined && body.row === undefined
				? null
				: {
						column: Math.min(
							body.column ?? 0,
							layoutColumns(access.row.layout as DashboardLayout) - 1,
						),
						row: body.row ?? 0,
					};
		let rowIndex = 0;
		if (placement) {
			const [counted] = await tx
				.select({ total: sql<number>`count(*)::int` })
				.from(dashboardGadgets)
				.where(
					and(
						eq(dashboardGadgets.dashboardId, access.row.id),
						eq(dashboardGadgets.columnIndex, placement.column),
					),
				);
			const total = Number(counted?.total ?? 0);
			rowIndex = Math.min(placement.row, total);
			if (rowIndex < total) {
				await tx
					.update(dashboardGadgets)
					.set({ rowIndex: sql`${dashboardGadgets.rowIndex} + 1` })
					.where(
						and(
							eq(dashboardGadgets.dashboardId, access.row.id),
							eq(dashboardGadgets.columnIndex, placement.column),
							gte(dashboardGadgets.rowIndex, rowIndex),
						),
					);
			}
		}
		const [created] = await tx
			.insert(dashboardGadgets)
			.values({
				dashboardId: access.row.id,
				type: body.type,
				title: body.title ?? null,
				columnIndex: placement?.column ?? 0,
				rowIndex,
				color: body.color ?? "color1",
				refreshSeconds: body.refreshSeconds ?? 0,
				config,
			})
			.returning({ id: dashboardGadgets.id });
		if (!created) return null;
		await renumberIn(tx, access.row.id);
		return created;
	});

	if (!row) throw new HttpError(400, "Gadget was not added");

	const gadget = (await loadGadgets(access.row.id)).find(
		(item) => item.id === row.id,
	);
	if (!gadget) throw new HttpError(400, "Gadget was not added");
	return gadget;
}

export async function updateGadget(
	actor: CurrentUser,
	id: string,
	body: GadgetPatchBody,
): Promise<GadgetRow> {
	const gadget = await loadGadgetOwner(id);
	if (!gadget) throw new HttpError(404, "Gadget not found");
	const access = await canEditDashboard(gadget.dashboardId, actor);
	if (access.status !== "ok") {
		throw new HttpError(
			access.status === "missing" ? 404 : 403,
			"Only the owner or an administrator can change this gadget",
		);
	}

	if (
		gadget.type === "introduction" &&
		body.config !== undefined &&
		!actor.isAdmin
	) {
		throw new HttpError(
			403,
			"Only an administrator can write the introduction",
		);
	}

	const config =
		body.config === undefined
			? undefined
			: await normalizeConfig(gadget.type, body.config);
	if (config === null) throw new HttpError(400, "Invalid gadget configuration");

	await db
		.update(dashboardGadgets)
		.set({
			...(body.title === undefined ? {} : { title: body.title }),
			...(body.color === undefined ? {} : { color: body.color }),
			...(body.refreshSeconds === undefined
				? {}
				: { refreshSeconds: body.refreshSeconds }),
			...(config === undefined ? {} : { config }),
			updatedAt: new Date(),
		})
		.where(eq(dashboardGadgets.id, gadget.id));

	const updated = (await loadGadgets(gadget.dashboardId)).find(
		(item) => item.id === gadget.id,
	);
	if (!updated) throw new HttpError(404, "Gadget not found");
	return updated;
}

export async function removeGadget(actor: CurrentUser, id: string) {
	const gadget = await loadGadgetOwner(id);
	if (!gadget) throw new HttpError(404, "Gadget not found");
	const access = await canEditDashboard(gadget.dashboardId, actor);
	if (access.status !== "ok") {
		throw new HttpError(
			access.status === "missing" ? 404 : 403,
			"Only the owner or an administrator can delete this gadget",
		);
	}

	await db.delete(dashboardGadgets).where(eq(dashboardGadgets.id, gadget.id));
	await renumber(gadget.dashboardId);
}

export async function getGadgetData(
	actor: CurrentUser,
	id: string,
	startAt: number,
) {
	const owner = await loadGadgetOwner(id);
	if (!owner) throw new HttpError(404, "Gadget not found");
	const dashboard = await loadDashboard(owner.dashboardId, actor);
	if (!dashboard) throw new HttpError(404, "Gadget not found");
	const gadget = dashboard.gadgets.find((item) => item.id === owner.id);
	if (!gadget) throw new HttpError(404, "Gadget not found");

	return loadGadgetData(owner.dashboardId, gadget, actor, startAt);
}

export async function setDashboardLayout(
	actor: CurrentUser,
	id: string,
	body: LayoutBody,
): Promise<DashboardDetail> {
	const access = await canEditDashboard(id, actor);
	if (access.status === "missing")
		throw new HttpError(404, "Dashboard not found");
	if (access.status === "forbidden") {
		throw new HttpError(
			403,
			"Only the owner or an administrator can move gadgets",
		);
	}

	const gadgets = await loadGadgets(access.row.id);
	const known = new Set(gadgets.map((gadget) => gadget.id));
	const placed = new Set<string>();
	for (const column of body.columns) {
		for (const id of column) {
			if (!known.has(id) || placed.has(id)) {
				throw new HttpError(
					400,
					"The layout names a gadget of another dashboard",
				);
			}
			placed.add(id);
		}
	}
	if (placed.size !== known.size) {
		throw new HttpError(400, "The layout must name every gadget once");
	}

	await db.transaction(async (tx) => {
		for (const [column, ids] of body.columns.entries()) {
			for (const [row, id] of ids.entries()) {
				await tx
					.update(dashboardGadgets)
					.set({
						columnIndex: column,
						rowIndex: row,
						updatedAt: new Date(),
					})
					.where(eq(dashboardGadgets.id, id));
			}
		}
	});

	const dashboard = await loadDashboard(access.row.id, actor);
	if (!dashboard) throw new HttpError(404, "Dashboard not found");
	return dashboard;
}

async function loadGadgetOwner(id: string) {
	const [row] = await db
		.select({
			id: dashboardGadgets.id,
			type: dashboardGadgets.type,
			dashboardId: dashboardGadgets.dashboardId,
		})
		.from(dashboardGadgets)
		.where(eq(dashboardGadgets.id, id))
		.limit(1);
	return row ?? null;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Rows are positions inside a column, so they stay dense after a move or delete. */
async function renumberIn(tx: Transaction, dashboardId: string) {
	const rows = await tx
		.select({
			id: dashboardGadgets.id,
			columnIndex: dashboardGadgets.columnIndex,
		})
		.from(dashboardGadgets)
		.where(eq(dashboardGadgets.dashboardId, dashboardId))
		.orderBy(asc(dashboardGadgets.columnIndex), asc(dashboardGadgets.rowIndex));

	const perColumn = new Map<number, number>();
	for (const row of rows) {
		const rowIndex = perColumn.get(row.columnIndex) ?? 0;
		perColumn.set(row.columnIndex, rowIndex + 1);
		await tx
			.update(dashboardGadgets)
			.set({ rowIndex })
			.where(eq(dashboardGadgets.id, row.id));
	}
}

async function renumber(dashboardId: string) {
	await db.transaction((tx) => renumberIn(tx, dashboardId));
}
