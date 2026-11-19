import { inArray, sql } from "drizzle-orm";
import {
	dashboardGadgets,
	dashboards as dashboardsTable,
	filterShares,
	filters as filtersTable,
	groups,
	projects,
	users,
} from "../lib/server/schema.ts";
import {
	type DashboardDataset,
	decode,
	type JiraDashboard,
	type JiraDashboardGadget,
	type JiraFilter,
	prefs,
} from "./dashboards.ts";
import { db } from "./db.ts";
import type { Executor } from "./upsert.ts";
import {
	type ImportCounts,
	mergeCounts,
	type RowCounts,
	upsertRows,
} from "./upsert.ts";

const GADGET_TYPES: Record<string, string> = {
	Introduction: "introduction",
	"Watched Issues": "watched-issues",
	"Assigned to Me": "assigned-to-me",
	"Activity Stream": "activity-stream",
	"Issue Statistics": "issue-statistics",
	"Filter Results": "filter-results",
	"Pie Chart": "pie-chart",
	"Two Dimensional Filter Statistics": "two-dimensional",
	"Created vs Resolved Chart": "created-vs-resolved",
	"Favourite Filters": "favourite-filters",
	"Quick Links": "quick-links",
};

const COLUMNS: Record<string, string> = {
	issuetype: "type",
	issuekey: "key",
	summary: "summary",
	priority: "priority",
	project: "project",
	reporter: "reporter",
	assignee: "assignee",
	status: "status",
	created: "created",
	updated: "updated",
	resolution: "resolution",
	duedate: "dueDate",
	labels: "labels",
	components: "components",
	fixfor: "fixVersions",
	timespent: "timeSpent",
	timeoriginalestimate: "originalEstimate",
	timeestimate: "remainingEstimate",
};

const STATISTICS: Record<string, string> = {
	statuses: "status",
	priorities: "priority",
	issuetypes: "type",
	assignee: "assignee",
	reporter: "reporter",
	project: "project",
	resolution: "resolution",
	components: "component",
	labels: "label",
	fixfor: "fixVersion",
	versions: "fixVersion",
};

export interface DashboardLookups {
	userIdByUsername: Map<string, string>;
	projectKeyBySourceId: Map<string, string>;
	filterIdBySourceId: Map<string, string>;
	fallbackUserId: string;
}

export interface DashboardRowInput {
	sourceId: string;
	name: string;
	description: string | null;
	ownerId: string;
	layout: "A" | "AA" | "AB" | "BA" | "AAA";
	shared: boolean;
}

export interface GadgetRowInput {
	sourceId: string;
	dashboardSourceId: string;
	type: string;
	title: string | null;
	columnIndex: number;
	rowIndex: number;
	color: string;
	refreshSeconds: number;
	config: Record<string, unknown>;
}

export function gadgetType(title: string) {
	return (
		GADGET_TYPES[title.trim()] ??
		title
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
	);
}

export function mapColumns(value: string | null) {
	if (!value || value === "--Default--") return [];
	const columns: string[] = [];
	for (const part of value.split("|")) {
		const id = COLUMNS[part];
		if (id) columns.push(id);
		else if (part.startsWith("customfield_")) columns.push(part);
	}
	return columns;
}

function statistic(value: string | null, fallback: string) {
	if (!value) return fallback;
	return STATISTICS[value] ?? fallback;
}

function refreshSeconds(value: string | null) {
	if (!value || value === "false") return 0;
	const minutes = Number(value);
	if (!Number.isFinite(minutes) || minutes <= 0) return 0;
	return Math.min(86_400, Math.round(minutes * 60));
}

function scope(
	value: string | null,
	lookups: DashboardLookups,
): { filterId: string | null; project: string | null } {
	const match = value?.match(/^(project|filter)-(.+)$/);
	if (!match) return { filterId: null, project: null };
	if (match[1] === "filter") {
		return {
			filterId: lookups.filterIdBySourceId.get(match[2] ?? "") ?? null,
			project: null,
		};
	}
	return {
		filterId: null,
		project: lookups.projectKeyBySourceId.get(match[2] ?? "") ?? null,
	};
}

function activityFilters(rules: string | null) {
	const decoded = decode(rules);
	if (!decoded) return { projects: [] as string[], users: [] as string[] };
	let parsed: {
		providers?: {
			provider?: string;
			disabled?: boolean;
			rules?: { rule?: string; value?: unknown }[];
		}[];
	};
	try {
		parsed = JSON.parse(decoded) as typeof parsed;
	} catch {
		return { projects: [], users: [] };
	}

	const projects: string[] = [];
	const users: string[] = [];
	for (const provider of parsed.providers ?? []) {
		if (provider.disabled) continue;
		for (const rule of provider.rules ?? []) {
			const values = Array.isArray(rule.value)
				? rule.value.filter(
						(value): value is string => typeof value === "string",
					)
				: typeof rule.value === "string"
					? [rule.value]
					: [];
			if (provider.provider === "streams" && rule.rule === "key") {
				projects.push(...values);
			}
			if (
				provider.provider === "issues" &&
				(rule.rule === "user" || rule.rule === "username")
			) {
				users.push(...values);
			}
		}
	}
	return { projects, users };
}

export function mapGadgetConfig(
	gadget: JiraDashboardGadget,
	type: string,
	lookups: DashboardLookups,
) {
	const values = prefs(gadget);
	const rows = Number(values.num ?? 10);
	const boundedRows = Number.isFinite(rows)
		? Math.min(100, Math.max(1, rows))
		: 10;

	switch (type) {
		case "assigned-to-me":
			return {
				columns: mapColumns(values.columnNames ?? null),
				rows: boundedRows,
			};
		case "watched-issues":
			return {
				columns: mapColumns(values.columnNames ?? null),
				rows: boundedRows,
				showResolved: values.showResolved !== "false",
			};
		case "filter-results":
			return {
				filterId: scope(values.projectOrFilterId ?? null, lookups).filterId,
				columns: mapColumns(values.columnNames ?? null),
				rows: boundedRows,
			};
		case "activity-stream": {
			const filters = activityFilters(values.rules ?? null);
			return {
				projects: filters.projects,
				users: filters.users,
				days: 7,
				rows: Number.isFinite(Number(values.numofentries))
					? Math.min(100, Math.max(1, Number(values.numofentries)))
					: 10,
			};
		}
		case "pie-chart":
		case "issue-statistics": {
			const { filterId, project } = scope(
				values.projectOrFilterId ?? null,
				lookups,
			);
			return {
				statistic: statistic(values.statType ?? null, "status"),
				filterId,
				project,
			};
		}
		case "two-dimensional": {
			const { filterId, project } = scope(
				values.projectOrFilterId ?? null,
				lookups,
			);
			return {
				xStatistic: statistic(values.xstat ?? null, "status"),
				yStatistic: statistic(values.ystat ?? null, "priority"),
				filterId,
				project,
			};
		}
		case "created-vs-resolved": {
			const { filterId, project } = scope(
				values.projectOrFilterId ?? null,
				lookups,
			);
			const days = Number(values.daysprevious ?? 30);
			return {
				filterId,
				project,
				days: Number.isFinite(days) ? Math.min(120, Math.max(2, days)) : 30,
			};
		}
		case "introduction":
			return {};
		case "favourite-filters":
			return {};
		case "quick-links":
			return { links: [] };
		default:
			return {};
	}
}

export function mapGadgets(
	dashboard: JiraDashboard,
	lookups: DashboardLookups,
): GadgetRowInput[] {
	const rowsPerColumn = new Map<number, number>();
	return dashboard.gadgets.map((gadget) => {
		const type = gadgetType(gadget.title);
		const column = Number.isFinite(gadget.column) ? gadget.column : 0;
		const row = rowsPerColumn.get(column) ?? 0;
		rowsPerColumn.set(column, row + 1);
		return {
			sourceId: gadget.id,
			dashboardSourceId: dashboard.id,
			type,
			title: GADGET_TYPES[gadget.title.trim()] ? null : gadget.title,
			columnIndex: column,
			rowIndex: row,
			color: /^color[1-6]$/.test(gadget.color) ? gadget.color : "color1",
			refreshSeconds: refreshSeconds(prefs(gadget).refresh ?? null),
			config: mapGadgetConfig(gadget, type, lookups),
		};
	});
}

/** Jira's built-in System Dashboard; the REST list marks no default, so the id identifies it. */
export const SYSTEM_DASHBOARD_ID = "10000";

/**
 * Jira does not expose who sees a dashboard, so a dashboard comes in private to
 * its owner and an administrator shares it in the app. The System Dashboard is
 * what every user lands on in Jira, so it is always shared with everyone.
 */
export function mapDashboard(
	dashboard: JiraDashboard,
	ownerId: string,
): DashboardRowInput {
	const layout = ["A", "AA", "AB", "BA", "AAA"].includes(dashboard.layout)
		? (dashboard.layout as DashboardRowInput["layout"])
		: "AA";
	return {
		sourceId: dashboard.id,
		name: dashboard.title.trim(),
		description: null,
		ownerId,
		layout,
		shared: dashboard.id === SYSTEM_DASHBOARD_ID,
	};
}

const SHARED_WITH_EVERYONE = new Set(["global", "loggedin", "authenticated"]);

export interface FilterShares {
	everyone: boolean;
	projectKeys: string[];
	groupNames: string[];
	/** A project share that names a role; the app shares it with the project. */
	roleShares: number;
	/** Share types the app has no equivalent for ("user"); the filter stays with fewer people. */
	ignored: string[];
}

export function mapFilterShares(
	filter: JiraFilter,
	projectKeyBySourceId: Map<string, string> = new Map(),
): FilterShares {
	const result: FilterShares = {
		everyone: false,
		projectKeys: [],
		groupNames: [],
		roleShares: 0,
		ignored: [],
	};
	for (const share of filter.sharePermissions ?? []) {
		if (SHARED_WITH_EVERYONE.has(share.type)) {
			result.everyone = true;
		} else if (share.type === "project" || share.type === "projectRole") {
			const key =
				share.project?.key ??
				(share.project?.id
					? projectKeyBySourceId.get(String(share.project.id))
					: undefined);
			if (key) result.projectKeys.push(key);
			else result.ignored.push(share.type);
			if (share.role) result.roleShares++;
		} else if (share.type === "group" && share.group?.name) {
			result.groupNames.push(share.group.name);
		} else {
			result.ignored.push(share.type);
		}
	}
	return result;
}

/** Counts per kind of share, for the import log. */
export function summarizeFilterShares(
	filters: JiraFilter[],
	projectKeyBySourceId?: Map<string, string>,
) {
	const summary = {
		filters: filters.length,
		everyone: 0,
		project: 0,
		projectRole: 0,
		group: 0,
		ownerOnly: 0,
		ignored: 0,
	};
	for (const filter of filters) {
		const shares = mapFilterShares(filter, projectKeyBySourceId);
		if (shares.everyone) summary.everyone++;
		summary.project += shares.projectKeys.length - shares.roleShares;
		summary.projectRole += shares.roleShares;
		summary.group += shares.groupNames.length;
		summary.ignored += shares.ignored.length;
		if (
			!shares.everyone &&
			shares.projectKeys.length === 0 &&
			shares.groupNames.length === 0
		) {
			summary.ownerOnly++;
		}
	}
	return summary;
}

export function mapFilter(
	filter: JiraFilter,
	ownerId: string,
	projectKeyBySourceId?: Map<string, string>,
) {
	return {
		sourceId: filter.id,
		name: filter.name,
		description: filter.description ?? null,
		jql: filter.jql,
		ownerId,
		columns: [] as string[],
		shared: mapFilterShares(filter, projectKeyBySourceId).everyone,
	};
}

/**
 * Jira owns the shares of an imported filter: put its project and group shares
 * in place and remove the ones Jira no longer lists.
 */
async function syncFilterShares(
	tx: Executor,
	filterIdBySourceId: Map<string, string>,
	filters: JiraFilter[],
	projectKeyBySourceId: Map<string, string>,
): Promise<RowCounts> {
	const counts = { inserted: 0, updated: 0, unchanged: 0 };
	const projectRows = await tx
		.select({ id: projects.id, key: projects.key })
		.from(projects);
	const projectIdByKey = new Map(
		projectRows.map((row) => [row.key.toLowerCase(), row.id]),
	);
	const groupRows = await tx
		.select({ id: groups.id, name: groups.name })
		.from(groups);
	const groupIdByName = new Map(
		groupRows.map((row) => [row.name.toLowerCase(), row.id]),
	);

	const desired = new Map<
		string,
		{ filterId: string; projectId: string | null; groupId: string | null }
	>();
	for (const filter of filters) {
		const filterId = filterIdBySourceId.get(filter.id);
		if (!filterId) continue;
		const shares = mapFilterShares(filter, projectKeyBySourceId);
		for (const key of shares.projectKeys) {
			const projectId = projectIdByKey.get(key.toLowerCase());
			if (projectId) {
				desired.set(`${filterId}:p:${projectId}`, {
					filterId,
					projectId,
					groupId: null,
				});
			}
		}
		for (const name of shares.groupNames) {
			let groupId = groupIdByName.get(name.toLowerCase());
			if (!groupId) {
				const [created] = await tx
					.insert(groups)
					.values({ name, local: false })
					.onConflictDoNothing()
					.returning({ id: groups.id });
				groupId = created?.id;
				if (groupId) groupIdByName.set(name.toLowerCase(), groupId);
			}
			if (groupId) {
				desired.set(`${filterId}:g:${groupId}`, {
					filterId,
					projectId: null,
					groupId,
				});
			}
		}
	}

	const filterIds = [...filterIdBySourceId.values()];
	if (filterIds.length === 0) return counts;
	const existing = await tx
		.select()
		.from(filterShares)
		.where(inArray(filterShares.filterId, filterIds));
	const keyOf = (row: {
		filterId: string;
		projectId: string | null;
		groupId: string | null;
	}) =>
		row.projectId
			? `${row.filterId}:p:${row.projectId}`
			: `${row.filterId}:g:${row.groupId}`;
	const present = new Set<string>();
	const stale: string[] = [];
	for (const row of existing) {
		if (desired.has(keyOf(row))) present.add(keyOf(row));
		else stale.push(row.id);
	}
	if (stale.length > 0) {
		await tx.delete(filterShares).where(inArray(filterShares.id, stale));
		counts.updated = stale.length;
	}
	const missing = [...desired]
		.filter(([key]) => !present.has(key))
		.map(([, row]) => row);
	if (missing.length > 0) await tx.insert(filterShares).values(missing);
	counts.inserted = missing.length;
	counts.unchanged = present.size;
	return counts;
}

async function upsertFavourites(
	tx: typeof db,
	table: "filter_favourites" | "dashboard_favourites",
	pairs: { userId: string; targetId: string }[],
): Promise<RowCounts> {
	const counts = { inserted: 0, updated: 0, unchanged: 0 };
	if (pairs.length === 0) return counts;
	const rows = await tx.execute(
		sql`select user_id, ${sql.raw(table === "filter_favourites" ? "filter_id" : "dashboard_id")} as target_id
			from ${sql.raw(table)}`,
	);
	const existing = new Set(
		(rows.rows as { user_id: string; target_id: string }[]).map(
			(row) => `${row.user_id}:${row.target_id}`,
		),
	);
	const missing = pairs.filter(
		(pair) => !existing.has(`${pair.userId}:${pair.targetId}`),
	);
	counts.unchanged = pairs.length - missing.length;
	if (missing.length === 0) return counts;

	await tx.execute(
		sql`insert into ${sql.raw(table)} (user_id, ${sql.raw(table === "filter_favourites" ? "filter_id" : "dashboard_id")})
			values ${sql.join(
				missing.map(
					(pair) => sql`(${pair.userId}::uuid, ${pair.targetId}::uuid)`,
				),
				sql`, `,
			)}
			on conflict do nothing`,
	);
	counts.inserted = missing.length;
	return counts;
}

export async function importDashboardDataset(
	dataset: DashboardDataset,
): Promise<ImportCounts> {
	const counts: ImportCounts = {};

	const userRows = await db
		.select({ id: users.id, username: users.username })
		.from(users);
	const userIdByUsername = new Map<string, string>();
	for (const row of userRows) {
		userIdByUsername.set(row.username.toLowerCase(), row.id);
	}

	const ownerId = userIdByUsername.get(dataset.owner.toLowerCase());
	if (!ownerId) {
		throw new Error(
			`Jira user ${dataset.owner} is not imported; run the jira step first`,
		);
	}

	const projectRows = await db.execute(
		sql`select source_id, key from projects`,
	);
	const projectKeyBySourceId = new Map<string, string>();
	for (const row of projectRows.rows as { source_id: string; key: string }[]) {
		projectKeyBySourceId.set(row.source_id, row.key);
	}

	const filterRows = await db.execute(
		sql`select id, source_id from filters where source_id is not null`,
	);
	const filterIdBySourceId = new Map<string, string>();
	for (const row of filterRows.rows as { id: string; source_id: string }[]) {
		filterIdBySourceId.set(row.source_id, row.id);
	}

	const lookups: DashboardLookups = {
		userIdByUsername,
		projectKeyBySourceId,
		filterIdBySourceId,
		fallbackUserId: ownerId,
	};

	await db.transaction(async (tx) => {
		const executor = tx as Executor;

		const filterRowsInput = dataset.filters.map((filter) =>
			mapFilter(
				filter,
				userIdByUsername.get(filter.owner.name.toLowerCase()) ??
					lookups.fallbackUserId,
				projectKeyBySourceId,
			),
		);
		const filters = await upsertRows(
			executor,
			filtersTable,
			filterRowsInput,
			(row) => String(row.sourceId),
		);
		mergeCounts(counts, "filters", filters.counts);
		for (const [sourceId, id] of filters.ids)
			filterIdBySourceId.set(sourceId, id);
		mergeCounts(
			counts,
			"filter_shares",
			await syncFilterShares(
				executor,
				filters.ids,
				dataset.filters,
				projectKeyBySourceId,
			),
		);

		const knownDashboards = dataset.dashboards.length
			? await executor
					.select({ sourceId: dashboardsTable.sourceId })
					.from(dashboardsTable)
					.where(
						inArray(
							dashboardsTable.sourceId,
							dataset.dashboards.map((dashboard) => dashboard.id),
						),
					)
			: [];
		const known = new Set(knownDashboards.map((row) => row.sourceId));
		const dashboardInput = dataset.dashboards.map((dashboard) => {
			const row = mapDashboard(
				dashboard,
				lookups.fallbackUserId,
			) as unknown as Record<string, unknown>;
			if (known.has(dashboard.id) && dashboard.id !== SYSTEM_DASHBOARD_ID) {
				row.shared = undefined;
			}
			return row;
		});
		const dashboards = await upsertRows(
			executor,
			dashboardsTable,
			dashboardInput,
			(row) => String(row.sourceId),
		);
		mergeCounts(counts, "dashboards", dashboards.counts);

		const gadgetInput: (GadgetRowInput & { dashboardId: string })[] = [];
		for (const dashboard of dataset.dashboards) {
			const dashboardId = dashboards.ids.get(dashboard.id);
			if (!dashboardId) continue;
			for (const gadget of mapGadgets(dashboard, lookups)) {
				gadgetInput.push({ ...gadget, dashboardId });
			}
		}
		const gadgets = await upsertRows(
			executor,
			dashboardGadgets,
			gadgetInput.map(({ dashboardSourceId: _source, ...row }) => row),
			(row) => String(row.sourceId),
		);
		mergeCounts(counts, "dashboard_gadgets", gadgets.counts);

		mergeCounts(
			counts,
			"filter_favourites",
			await upsertFavourites(
				tx as unknown as typeof db,
				"filter_favourites",
				dataset.favouriteFilters
					.map((sourceId) => filterIdBySourceId.get(sourceId))
					.filter((id): id is string => id !== undefined)
					.map((filterId) => ({
						userId: lookups.fallbackUserId,
						targetId: filterId,
					})),
			),
		);

		mergeCounts(
			counts,
			"dashboard_favourites",
			await upsertFavourites(
				tx as unknown as typeof db,
				"dashboard_favourites",
				dataset.favouriteDashboards
					.map((sourceId) => dashboards.ids.get(sourceId))
					.filter((id): id is string => id !== undefined)
					.map((dashboardId) => ({
						userId: lookups.fallbackUserId,
						targetId: dashboardId,
					})),
			),
		);
	});

	return counts;
}
