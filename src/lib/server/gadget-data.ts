import { eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { formatDuration } from "../shared/agile-reports/types.ts";
import {
	gadgetColumns,
	isSafeLinkUrl,
	STATISTICS,
	type StatisticType,
} from "../shared/gadgets.ts";
import { JqlError, parseJql, quoteJqlValue } from "../shared/jql/index.ts";
import { userRefSchema } from "./api-schemas.ts";
import type { GadgetRow } from "./dashboards/schemas.ts";
import { db } from "./db.ts";
import { listFilters, loadVisibleFilter } from "./filters/service.ts";
import { sanitizeBodyHtml } from "./html.ts";
import { HttpError } from "./http.ts";
import { loadCatalog } from "./jql/catalog.ts";
import { compileJql, type SearchUser } from "./jql/compile.ts";
import { withStatementTimeout } from "./jql/timeout.ts";
import { loadNavigatorPage } from "./navigator/service.ts";
import { viewerProjectIds } from "./permissions.ts";
import {
	comments,
	dashboards,
	issueHistory,
	issues,
	watchers,
} from "./schema.ts";
import {
	agentProjectIds,
	readableCommentCondition,
} from "./servicedesk/access.ts";

const MAX_ROWS = 100;
const ACTIVITY_DAYS = 90;

const issueListSchema = z.object({
	startAt: z.number().int(),
	maxResults: z.number().int(),
	total: z.number().int(),
	issues: z.array(z.record(z.string(), z.unknown())),
});

const activityEntrySchema = z.object({
	kind: z.enum(["comment", "history", "created"]),
	issueKey: z.string(),
	issueSummary: z.string(),
	author: userRefSchema.nullable(),
	created: z.iso.datetime(),
	text: z.string().nullable(),
});

export const gadgetDataSchema = z.object({
	kind: z.string(),
	title: z.string(),
	config: z.record(z.string(), z.unknown()),
	refreshSeconds: z.number().int(),
	issueList: issueListSchema.optional(),
	slices: z
		.array(z.object({ label: z.string(), value: z.number().int() }))
		.optional(),
	matrix: z
		.object({
			columns: z.array(z.string()),
			rows: z.array(
				z.object({
					label: z.string(),
					cells: z.array(z.number().int()),
					total: z.number().int(),
				}),
			),
			totals: z.array(z.number().int()),
			total: z.number().int(),
		})
		.optional(),
	series: z
		.object({
			days: z.array(z.string()),
			created: z.array(z.number().int()),
			resolved: z.array(z.number().int()),
		})
		.optional(),
	activity: z
		.array(
			z.object({
				day: z.string(),
				entries: z.array(activityEntrySchema),
			}),
		)
		.optional(),
	filters: z
		.array(
			z.object({
				id: z.uuid(),
				name: z.string(),
				description: z.string().nullable(),
				total: z.number().int(),
			}),
		)
		.optional(),
	links: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
	html: z.string().optional(),
});

export type GadgetData = z.infer<typeof gadgetDataSchema>;

type Viewer = SearchUser & { isAdmin: boolean };

function clampRows(value: unknown) {
	const rows = Number(value ?? 10);
	if (!Number.isFinite(rows)) return 10;
	return Math.min(MAX_ROWS, Math.max(1, Math.trunc(rows)));
}

function clampDays(value: unknown, min: number, max: number, fallback: number) {
	const days = Number(value ?? fallback);
	if (!Number.isFinite(days)) return fallback;
	return Math.min(max, Math.max(min, days));
}

function stringList(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function emptyList() {
	return { startAt: 0, maxResults: 0, total: 0, issues: [] };
}

async function issuePage(
	jql: string | null,
	config: Record<string, unknown>,
	user: Viewer,
	startAt: number,
) {
	if (!jql) return emptyList();
	const page = await loadNavigatorPage(
		{
			jql,
			startAt,
			maxResults: clampRows(config.rows),
			columns: gadgetColumns(config),
			storedJql: true,
		},
		user,
	);
	return {
		startAt: page.startAt,
		maxResults: page.maxResults,
		total: page.total,
		issues: page.issues as unknown as Record<string, unknown>[],
	};
}

/** A gadget counts either the issues of a saved filter or of one project. */
async function scopeJql(
	config: Record<string, unknown>,
	user: Viewer,
): Promise<string | null> {
	const filterId = typeof config.filterId === "string" ? config.filterId : null;
	if (filterId) {
		const filter = await loadVisibleFilter(user, filterId);
		return filter?.jql ?? null;
	}
	const project = typeof config.project === "string" ? config.project : null;
	if (project) {
		return `project = ${quoteJqlValue(project)} ORDER BY key DESC`;
	}
	return "ORDER BY key DESC";
}

async function scopedWhere(config: Record<string, unknown>, user: Viewer) {
	const jql = await scopeJql(config, user);
	if (jql === null) return sql`false`;
	try {
		return await compiledWhere(jql, user);
	} catch (error) {
		if (error instanceof JqlError) throw new HttpError(400, error.jiraMessage);
		throw error;
	}
}

async function compiledWhere(jql: string, user: Viewer): Promise<SQL> {
	const compiled = await compileJql(parseJql(jql), {
		user,
		catalog: await loadCatalog(),
		visibleProjectIds: await viewerProjectIds(user),
	});
	return compiled.where ?? sql`true`;
}

/**
 * Every statistic is one left join and one label expression over `issues`, so a
 * slice query and a cross tab share them.
 */
const SCALAR_AXES: Record<
	Exclude<StatisticType, "component" | "label" | "fixVersion">,
	{ join: string; expression: string }
> = {
	status: {
		join: "left join statuses s on s.id = issues.status_id",
		expression: "coalesce(s.name, 'None')",
	},
	priority: {
		join: "left join priorities p on p.id = issues.priority_id",
		expression: "coalesce(p.name, 'None')",
	},
	type: {
		join: "left join issue_types it on it.id = issues.type_id",
		expression: "coalesce(it.name, 'None')",
	},
	assignee: {
		join: "left join users a on a.id = issues.assignee_id",
		expression: "coalesce(a.display_name, 'Unassigned')",
	},
	reporter: {
		join: "left join users r on r.id = issues.reporter_id",
		expression: "coalesce(r.display_name, 'None')",
	},
	project: {
		join: "left join projects pr on pr.id = issues.project_id",
		expression: "coalesce(pr.name, 'None')",
	},
	resolution: {
		join: "left join resolutions res on res.id = issues.resolution_id",
		expression: "coalesce(res.name, 'Unresolved')",
	},
};

const STATISTIC_TYPES = new Set(STATISTICS.map((statistic) => statistic.value));

function axis(statistic: StatisticType, alias: string) {
	if (!STATISTIC_TYPES.has(statistic)) {
		throw new HttpError(400, `Unknown statistic: ${String(statistic)}`);
	}
	if (statistic === "component") {
		return {
			join: sql`left join issue_components ic_${sql.raw(alias)} on ic_${sql.raw(alias)}.issue_id = issues.id
				left join components c_${sql.raw(alias)} on c_${sql.raw(alias)}.id = ic_${sql.raw(alias)}.component_id`,
			expression: sql`coalesce(c_${sql.raw(alias)}.name, 'No component')`,
		};
	}
	if (statistic === "label") {
		return {
			join: sql`left join issue_labels il_${sql.raw(alias)} on il_${sql.raw(alias)}.issue_id = issues.id`,
			expression: sql`coalesce(il_${sql.raw(alias)}.label, 'No label')`,
		};
	}
	if (statistic === "fixVersion") {
		return {
			join: sql`left join issue_fix_versions fv_${sql.raw(alias)} on fv_${sql.raw(alias)}.issue_id = issues.id
				left join versions v_${sql.raw(alias)} on v_${sql.raw(alias)}.id = fv_${sql.raw(alias)}.version_id`,
			expression: sql`coalesce(v_${sql.raw(alias)}.name, 'No version')`,
		};
	}
	const spec = SCALAR_AXES[statistic];
	return {
		join: sql.raw(spec.join),
		expression: sql.raw(spec.expression),
	};
}

export async function statisticSlices(statistic: StatisticType, where: SQL) {
	const resolved = axis(statistic, "x");
	const result = await withStatementTimeout((tx) =>
		tx.execute(sql`
		select ${resolved.expression} as label, count(distinct issues.id)::int as total
		from issues
		${resolved.join}
		where ${where}
		group by 1
		order by 2 desc, 1
	`),
	);
	return (result.rows as { label: string | null; total: number }[]).map(
		(row) => ({ label: row.label ?? "None", value: Number(row.total) }),
	);
}

export async function statisticMatrix(
	xStatistic: StatisticType,
	yStatistic: StatisticType,
	where: SQL,
) {
	const x = axis(xStatistic, "x");
	const y = axis(yStatistic, "y");
	const result = await withStatementTimeout((tx) =>
		tx.execute(sql`
		select ${x.expression} as x, ${y.expression} as y, count(distinct issues.id)::int as total
		from issues
		${x.join}
		${y.join}
		where ${where}
		group by 1, 2
	`),
	);
	const rows = result.rows as {
		x: string | null;
		y: string | null;
		total: number;
	}[];

	const columns = [...new Set(rows.map((row) => row.y ?? "None"))].sort(
		(left, right) => left.localeCompare(right),
	);
	const byRow = new Map<string, Map<string, number>>();
	for (const row of rows) {
		const label = row.x ?? "None";
		const cells = byRow.get(label) ?? new Map<string, number>();
		cells.set(row.y ?? "None", Number(row.total));
		byRow.set(label, cells);
	}

	const matrixRows = [...byRow.entries()]
		.map(([label, cells]) => {
			const values = columns.map((column) => cells.get(column) ?? 0);
			return {
				label,
				cells: values,
				total: values.reduce((total, value) => total + value, 0),
			};
		})
		.sort(
			(left, right) =>
				right.total - left.total || left.label.localeCompare(right.label),
		);
	const totals = columns.map((_column, index) =>
		matrixRows.reduce((total, row) => total + (row.cells[index] ?? 0), 0),
	);

	return {
		columns,
		rows: matrixRows,
		totals,
		total: totals.reduce((total, value) => total + value, 0),
	};
}

function dayKey(value: Date) {
	return value.toISOString().slice(0, 10);
}

function dayRange(days: number) {
	const today = new Date();
	const result: string[] = [];
	for (let index = days - 1; index >= 0; index--) {
		const day = new Date(today);
		day.setUTCDate(day.getUTCDate() - index);
		result.push(dayKey(day));
	}
	return result;
}

async function createdVsResolved(where: SQL, days: number) {
	const keys = dayRange(days);
	const since = `${keys[0]}T00:00:00Z`;
	const [created, resolved] = await withStatementTimeout(async (tx) => [
		await tx.execute(sql`
		select to_char(issues.created, 'YYYY-MM-DD') as day, count(*)::int as total
		from issues
		where ${where} and issues.created >= ${since}
		group by 1
	`),
		await tx.execute(sql`
		select to_char(issues.resolved, 'YYYY-MM-DD') as day, count(*)::int as total
		from issues
		where ${where} and issues.resolved >= ${since}
		group by 1
	`),
	]);
	const createdByDay = new Map(
		(created.rows as { day: string; total: number }[]).map((row) => [
			row.day,
			Number(row.total),
		]),
	);
	const resolvedByDay = new Map(
		(resolved.rows as { day: string; total: number }[]).map((row) => [
			row.day,
			Number(row.total),
		]),
	);
	return {
		days: keys,
		created: keys.map((day) => createdByDay.get(day) ?? 0),
		resolved: keys.map((day) => resolvedByDay.get(day) ?? 0),
	};
}

const historyFieldNames: Record<string, string> = {
	status: "Status",
	resolution: "Resolution",
	assignee: "Assignee",
	reporter: "Reporter",
	priority: "Priority",
	summary: "Summary",
	labels: "Labels",
	duedate: "Due Date",
	timeestimate: "Remaining Estimate",
	timeoriginalestimate: "Original Estimate",
	timespent: "Time Spent",
	issuetype: "Issue Type",
	parent: "Parent",
	component: "Component",
	description: "Description",
};

type HistoryChange = { field: string; from: string | null; to: string | null };

function describeChanges(changes: HistoryChange[]) {
	return changes
		.map(({ field, from, to }) => {
			const label = historyFieldNames[field.toLowerCase()] ?? field;
			const isTime = /^time/i.test(field);
			const show = (value: string | null) =>
				isTime && value !== null && /^\d+$/.test(value)
					? formatDuration(Number(value))
					: (value ?? "").slice(0, 80);
			const before = show(from);
			const after = show(to);
			if (before === "" && after === "") return label;
			if (before === "") return `${label}: ${after}`;
			return `${label}: ${before} → ${after === "" ? "None" : after}`;
		})
		.join(", ");
}

async function activityStream(config: Record<string, unknown>, user: Viewer) {
	const days = clampDays(config.days, 1, ACTIVITY_DAYS, 7);
	const rows = clampRows(config.rows);
	const projects = stringList(config.projects).map((key) => key.toUpperCase());
	const usernames = stringList(config.users);
	const since = new Date();
	since.setUTCDate(since.getUTCDate() - days);

	const projectFilter =
		projects.length > 0
			? sql`and proj.key = any(${sql.param(projects)}::text[])`
			: sql``;
	const userFilter =
		usernames.length > 0
			? sql`and author.username = any(${sql.param(usernames)}::text[])`
			: sql``;

	const visible = sql`proj.id = any(${sql.param(await viewerProjectIds(user))}::uuid[])`;
	const agentProjects = await agentProjectIds(user);
	const result = await db.execute(sql`
		select 'comment' as kind, i.key as issue_key, i.summary as issue_summary,
			author.username as author_username, author.display_name as author_name,
			author.id as author_id, c.created, left(c.body_source, 240) as text
		from ${comments} c
		join ${issues} i on i.id = c.issue_id
		join projects proj on proj.id = i.project_id
		left join users author on author.id = c.author_id
		where c.created >= ${since} ${projectFilter} ${userFilter} and ${visible}
			and ${readableCommentCondition(sql`c.internal`, sql`proj.id`, agentProjects)}
		union all
		select 'history' as kind, i.key as issue_key, i.summary as issue_summary,
			author.username as author_username, author.display_name as author_name,
			author.id as author_id, h.created,
			(select jsonb_agg(jsonb_build_object('field', coalesce(hi.field, 'field'),
				'from', coalesce(hi.from_string, hi.from_value),
				'to', coalesce(hi.to_string, hi.to_value)) order by hi.sequence)::text
			 from issue_history_items hi where hi.history_id = h.id) as text
		from ${issueHistory} h
		join ${issues} i on i.id = h.issue_id
		join projects proj on proj.id = i.project_id
		left join users author on author.id = h.author_id
		where h.created >= ${since} ${projectFilter} ${userFilter} and ${visible}
		union all
		select 'created' as kind, i.key as issue_key, i.summary as issue_summary,
			author.username as author_username, author.display_name as author_name,
			author.id as author_id, i.created, null as text
		from ${issues} i
		join projects proj on proj.id = i.project_id
		left join users author on author.id = i.reporter_id
		where i.created >= ${since} ${projectFilter} ${userFilter} and ${visible}
		order by created desc
		limit ${rows}
	`);

	const groups = new Map<string, z.infer<typeof activityEntrySchema>[]>();
	for (const row of result.rows as Record<string, unknown>[]) {
		if (row.created === null) continue;
		const created = new Date(row.created as string);
		const day = dayKey(created);
		const entries = groups.get(day) ?? [];
		entries.push({
			kind: String(row.kind) as "comment" | "history" | "created",
			issueKey: String(row.issue_key),
			issueSummary: String(row.issue_summary),
			author: row.author_id
				? {
						id: String(row.author_id),
						username: String(row.author_username),
						displayName: String(row.author_name),
						avatarUrl: `/api/avatars/users/${row.author_id}`,
					}
				: null,
			created: created.toISOString(),
			text:
				row.text === null
					? null
					: row.kind === "history"
						? describeChanges(JSON.parse(String(row.text)) as HistoryChange[])
						: String(row.text),
		});
		groups.set(day, entries);
	}

	return [...groups.entries()]
		.sort((left, right) => right[0].localeCompare(left[0]))
		.map(([day, entries]) => ({ day, entries }));
}

async function watchedJql(config: Record<string, unknown>, user: Viewer) {
	const rows = await db
		.select({ key: issues.key })
		.from(watchers)
		.innerJoin(issues, eq(issues.id, watchers.issueId))
		.where(eq(watchers.userId, user.id))
		.orderBy(sql`${issues.updated} desc nulls last`)
		.limit(200);
	const keys = rows.map((row) => row.key);
	if (keys.length === 0) return null;
	const open =
		config.showResolved === false ? " AND resolution = Unresolved" : "";
	return `key in (${keys.map((key) => `"${key}"`).join(", ")})${open} ORDER BY updated DESC`;
}

async function favouriteFilterGadget(user: Viewer) {
	const rows = (await listFilters(user, { scope: "favourite", query: "" }))
		.sort((left, right) => left.name.localeCompare(right.name))
		.slice(0, 20);

	const result: {
		id: string;
		name: string;
		description: string | null;
		total: number;
	}[] = [];
	for (const row of rows) {
		let total = 0;
		try {
			const where = await compiledWhere(row.jql, user);
			const counted = await withStatementTimeout((tx) =>
				tx.execute(
					sql`select count(*)::int as total from issues where ${where}`,
				),
			);
			total = Number((counted.rows[0] as { total: number }).total);
		} catch (error) {
			if (!(error instanceof JqlError)) throw error;
		}
		result.push({
			id: row.id,
			name: row.name,
			description: row.description,
			total,
		});
	}
	return result;
}

export async function loadGadgetData(
	dashboardId: string,
	gadget: GadgetRow,
	user: Viewer,
	startAt: number,
): Promise<GadgetData> {
	const [dashboard] = await db
		.select({ ownerId: dashboards.ownerId, shared: dashboards.shared })
		.from(dashboards)
		.where(eq(dashboards.id, dashboardId))
		.limit(1);
	if (
		!dashboard ||
		(!dashboard.shared && dashboard.ownerId !== user.id && !user.isAdmin)
	) {
		throw new HttpError(404, "Gadget not found");
	}
	const config = gadget.config ?? {};
	const base = {
		kind: gadget.type,
		title: gadget.title ?? "",
		config,
		refreshSeconds: gadget.refreshSeconds,
	};

	switch (gadget.type) {
		case "introduction":
			return {
				...base,
				html:
					(await sanitizeBodyHtml(
						typeof config.html === "string" ? config.html : "",
					)) ?? "",
			};
		case "assigned-to-me":
			return {
				...base,
				issueList: await issuePage(
					"assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
					config,
					user,
					startAt,
				),
			};
		case "watched-issues":
			return {
				...base,
				issueList: await issuePage(
					await watchedJql(config, user),
					config,
					user,
					startAt,
				),
			};
		case "filter-results": {
			const filterId =
				typeof config.filterId === "string" ? config.filterId : null;
			const filter = filterId ? await loadVisibleFilter(user, filterId) : null;
			return {
				...base,
				issueList: await issuePage(filter?.jql ?? null, config, user, startAt),
			};
		}
		case "activity-stream":
			return { ...base, activity: await activityStream(config, user) };
		case "pie-chart":
		case "issue-statistics": {
			const statistic = (config.statistic ?? "status") as StatisticType;
			const where = await scopedWhere(config, user);
			return { ...base, slices: await statisticSlices(statistic, where) };
		}
		case "two-dimensional": {
			const x = (config.xStatistic ?? "status") as StatisticType;
			const y = (config.yStatistic ?? "priority") as StatisticType;
			if (x === y) {
				throw new HttpError(400, "Choose two different statistics");
			}
			const where = await scopedWhere(config, user);
			return { ...base, matrix: await statisticMatrix(x, y, where) };
		}
		case "created-vs-resolved": {
			const days = clampDays(config.days, 2, 120, 30);
			const where = await scopedWhere(config, user);
			return { ...base, series: await createdVsResolved(where, days) };
		}
		case "favourite-filters":
			return { ...base, filters: await favouriteFilterGadget(user) };
		case "quick-links": {
			const links = Array.isArray(config.links)
				? (config.links as { title?: unknown; url?: unknown }[])
						.filter(
							(link) =>
								typeof link.title === "string" &&
								typeof link.url === "string" &&
								isSafeLinkUrl(link.url),
						)
						.map((link) => ({
							title: String(link.title),
							url: String(link.url).trim(),
						}))
				: [];
			return { ...base, links };
		}
		default:
			return base;
	}
}
