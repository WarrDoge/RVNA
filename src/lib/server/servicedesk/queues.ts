import { and, asc, eq, inArray } from "drizzle-orm";
import { JqlError } from "../../shared/jql/index.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import {
	components,
	fields,
	issueComponents,
	issueLabels,
	issues,
	issueTypes,
	priorities,
	queues,
	requestTypes,
	resolutions,
	slaCalendars,
	slaCycles,
	slaGoals,
	slaMetrics,
	statuses,
	users,
	watchers,
} from "../schema.ts";
import { searchIssues } from "../search/service.ts";
import type { Desk } from "./access.ts";
import { displayCycle, type SlaState, type StoredCycle } from "./sla.ts";
import { customDate, customText } from "./values.ts";

export type CellKind =
	| "key"
	| "summary"
	| "type"
	| "status"
	| "priority"
	| "user"
	| "text"
	| "date"
	| "components"
	| "sla";

export interface QueueCell {
	kind: CellKind;
	text: string | null;
	href: string | null;
	category: string | null;
	iconColor: string | null;
	state: SlaState | null;
	remainingMinutes: number | null;
	breached: boolean | null;
	names: string[];
}

export interface QueueColumn {
	id: string;
	label: string;
	kind: CellKind;
}

export interface QueueIssueRow {
	key: string;
	summary: string;
	cells: Record<string, QueueCell>;
}

export interface QueueListEntry {
	id: string;
	name: string;
	jql: string;
	parentId: string | null;
	sequence: number;
	issueCount: number | null;
	liveCount: number | null;
}

const builtinColumns: Record<string, { label: string; kind: CellKind }> = {
	issuekey: { label: "Key", kind: "key" },
	issuetype: { label: "Type", kind: "type" },
	status: { label: "Status", kind: "status" },
	summary: { label: "Summary", kind: "summary" },
	created: { label: "Created", kind: "date" },
	updated: { label: "Updated", kind: "date" },
	duedate: { label: "Due", kind: "date" },
	priority: { label: "Priority", kind: "priority" },
	reporter: { label: "Reporter", kind: "user" },
	assignee: { label: "Assignee", kind: "user" },
	components: { label: "Components", kind: "components" },
	resolution: { label: "Resolution", kind: "text" },
	labels: { label: "Labels", kind: "text" },
	watchers: { label: "Watchers", kind: "text" },
	workratio: { label: "Work ratio", kind: "text" },
};

function emptyCell(kind: CellKind): QueueCell {
	return {
		kind,
		text: null,
		href: null,
		category: null,
		iconColor: null,
		state: null,
		remainingMinutes: null,
		breached: null,
		names: [],
	};
}

async function columnSpecs(
	desk: Desk,
	columnIds: string[],
): Promise<QueueColumn[]> {
	const customIds = columnIds.filter((id) => !(id in builtinColumns));
	const [fieldRows, metricRows] = await Promise.all([
		customIds.length === 0
			? []
			: db
					.select({
						sourceId: fields.sourceId,
						name: fields.name,
						type: fields.type,
					})
					.from(fields)
					.where(inArray(fields.sourceId, customIds)),
		db
			.select({ id: slaMetrics.id, name: slaMetrics.name })
			.from(slaMetrics)
			.where(eq(slaMetrics.deskId, desk.id)),
	]);
	const fieldsBySource = new Map(fieldRows.map((row) => [row.sourceId, row]));
	const metricsByName = new Map(metricRows.map((row) => [row.name, row]));

	return columnIds.map((id) => {
		const builtin = builtinColumns[id];
		if (builtin) return { id, ...builtin };
		const field = fieldsBySource.get(id);
		const metric = field ? metricsByName.get(field.name) : undefined;
		if (metric) return { id, label: metric.name, kind: "sla" };
		if (!field) return { id, label: id, kind: "text" };
		const kind: CellKind =
			field.type === "datetime"
				? "date"
				: field.type === "sd-servicelevelagreement"
					? "sla"
					: "text";
		return { id, label: field.name, kind };
	});
}

/** SLA columns are custom fields whose name is the metric name. */
async function metricForColumn(
	desk: Desk,
	column: QueueColumn,
): Promise<string | null> {
	if (column.kind !== "sla") return null;
	const [metric] = await db
		.select({ id: slaMetrics.id })
		.from(slaMetrics)
		.where(
			and(eq(slaMetrics.deskId, desk.id), eq(slaMetrics.name, column.label)),
		)
		.limit(1);
	return metric?.id ?? null;
}

interface QueueIssue {
	id: string;
	key: string;
	summary: string;
	created: Date | null;
	updated: Date | null;
	duedate: string | null;
	custom: Record<string, unknown>;
	typeName: string;
	statusName: string;
	statusCategory: string;
	priorityName: string | null;
	priorityColor: string | null;
	reporterName: string | null;
	assigneeName: string | null;
	requestTypeName: string | null;
	resolutionName: string | null;
	componentNames: string[];
	labels: string[];
	watchers: string[];
	workRatio: number | null;
}

async function loadQueueIssues(
	keys: string[],
): Promise<Map<string, QueueIssue>> {
	if (keys.length === 0) return new Map();
	const rows = await db
		.select({
			id: issues.id,
			key: issues.key,
			summary: issues.summary,
			created: issues.created,
			updated: issues.updated,
			duedate: issues.dueDate,
			custom: issues.custom,
			typeName: issueTypes.name,
			statusName: statuses.name,
			statusCategory: statuses.category,
			priorityName: priorities.name,
			priorityColor: priorities.iconColor,
			requestTypeName: requestTypes.name,
			resolutionName: resolutions.name,
			originalEstimate: issues.originalEstimate,
			timeSpent: issues.timeSpent,
		})
		.from(issues)
		.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(priorities, eq(priorities.id, issues.priorityId))
		.leftJoin(requestTypes, eq(requestTypes.id, issues.requestTypeId))
		.leftJoin(resolutions, eq(resolutions.id, issues.resolutionId))
		.where(inArray(issues.key, keys));

	const ids = rows.map((row) => row.id);
	const [people, componentRows, assigneeRows, labelRows, watcherRows] =
		await Promise.all([
			ids.length === 0
				? []
				: db
						.select({
							issueId: issues.id,
							reporterName: users.displayName,
						})
						.from(issues)
						.leftJoin(users, eq(users.id, issues.reporterId))
						.where(inArray(issues.id, ids)),
			ids.length === 0
				? []
				: db
						.select({ issueId: issueComponents.issueId, name: components.name })
						.from(issueComponents)
						.innerJoin(
							components,
							eq(components.id, issueComponents.componentId),
						)
						.where(inArray(issueComponents.issueId, ids)),
			ids.length === 0
				? []
				: db
						.select({ issueId: issues.id, name: users.displayName })
						.from(issues)
						.leftJoin(users, eq(users.id, issues.assigneeId))
						.where(inArray(issues.id, ids)),
			ids.length === 0
				? []
				: db
						.select({ issueId: issueLabels.issueId, label: issueLabels.label })
						.from(issueLabels)
						.where(inArray(issueLabels.issueId, ids))
						.orderBy(asc(issueLabels.label)),
			ids.length === 0
				? []
				: db
						.select({
							issueId: watchers.issueId,
							name: users.displayName,
						})
						.from(watchers)
						.innerJoin(users, eq(users.id, watchers.userId))
						.where(inArray(watchers.issueId, ids))
						.orderBy(asc(users.displayName)),
		]);

	const reporterNames = new Map(
		people.map((row) => [row.issueId, row.reporterName]),
	);
	const assigneeNames = new Map(
		assigneeRows.map((row) => [row.issueId, row.name]),
	);
	const componentsByIssue = new Map<string, string[]>();
	for (const row of componentRows) {
		const list = componentsByIssue.get(row.issueId) ?? [];
		list.push(row.name);
		componentsByIssue.set(row.issueId, list);
	}
	const labelsByIssue = new Map<string, string[]>();
	for (const row of labelRows) {
		const list = labelsByIssue.get(row.issueId) ?? [];
		list.push(row.label);
		labelsByIssue.set(row.issueId, list);
	}
	const watchersByIssue = new Map<string, string[]>();
	for (const row of watcherRows) {
		const list = watchersByIssue.get(row.issueId) ?? [];
		list.push(row.name);
		watchersByIssue.set(row.issueId, list);
	}

	return new Map(
		rows.map((row) => [
			row.key,
			{
				id: row.id,
				key: row.key,
				summary: row.summary,
				created: row.created,
				updated: row.updated,
				duedate: row.duedate,
				custom: row.custom as Record<string, unknown>,
				typeName: row.typeName,
				statusName: row.statusName,
				statusCategory: row.statusCategory,
				priorityName: row.priorityName,
				priorityColor: row.priorityColor,
				reporterName: reporterNames.get(row.id) ?? null,
				assigneeName: assigneeNames.get(row.id) ?? null,
				requestTypeName: row.requestTypeName,
				resolutionName: row.resolutionName,
				componentNames: componentsByIssue.get(row.id) ?? [],
				labels: labelsByIssue.get(row.id) ?? [],
				watchers: watchersByIssue.get(row.id) ?? [],
				workRatio:
					row.originalEstimate !== null && row.originalEstimate > 0
						? Math.round(((row.timeSpent ?? 0) / row.originalEstimate) * 100)
						: null,
			},
		]),
	);
}

async function slaCells(
	desk: Desk,
	columns: QueueColumn[],
	issueRows: Map<string, QueueIssue>,
	now: Date,
): Promise<Map<string, Map<string, QueueCell>>> {
	const result = new Map<string, Map<string, QueueCell>>();
	const metricColumns: { column: QueueColumn; metricId: string }[] = [];
	for (const column of columns) {
		const metricId = await metricForColumn(desk, column);
		if (metricId) metricColumns.push({ column, metricId });
	}
	if (metricColumns.length === 0 || issueRows.size === 0) return result;

	const issueIds = [...issueRows.values()].map((row) => row.id);
	const cycleRows = await db
		.select()
		.from(slaCycles)
		.where(
			and(
				inArray(slaCycles.issueId, issueIds),
				inArray(
					slaCycles.metricId,
					metricColumns.map((entry) => entry.metricId),
				),
			),
		)
		.orderBy(asc(slaCycles.cycleNumber));

	const goalRows = await db
		.select()
		.from(slaGoals)
		.where(
			inArray(
				slaGoals.metricId,
				metricColumns.map((entry) => entry.metricId),
			),
		)
		.orderBy(asc(slaGoals.sequence));
	const calendarIds = [...new Set(goalRows.map((goal) => goal.calendarId))];
	const calendarRows =
		calendarIds.length === 0
			? []
			: await db
					.select()
					.from(slaCalendars)
					.where(inArray(slaCalendars.id, calendarIds));
	const calendars = new Map(calendarRows.map((row) => [row.id, row]));

	const issueIdByKey = new Map(
		[...issueRows.values()].map((row) => [row.id, row.key]),
	);

	for (const cycle of cycleRows) {
		const key = issueIdByKey.get(cycle.issueId);
		if (!key) continue;
		const column = metricColumns.find(
			(entry) => entry.metricId === cycle.metricId,
		);
		if (!column) continue;
		const goals = goalRows.filter((goal) => goal.metricId === cycle.metricId);
		const goal =
			goals.find((item) => item.id === cycle.goalId) ??
			goals.find((item) => item.goalMinutes === cycle.goalMinutes) ??
			goals[0];
		const calendar = goal ? calendars.get(goal.calendarId) : undefined;
		const display = displayCycle(
			cycle as StoredCycle,
			calendar
				? {
						timezone: calendar.timezone,
						workingHours: calendar.workingHours,
						holidays: calendar.holidays,
					}
				: null,
			now,
		);
		const cells = result.get(key) ?? new Map<string, QueueCell>();
		const existing = cells.get(column.column.id);
		const cell: QueueCell = {
			...emptyCell("sla"),
			state: display.state,
			remainingMinutes: display.remainingMinutes,
			breached: display.breached,
			text:
				display.remainingMinutes === null
					? null
					: String(display.remainingMinutes),
		};
		// The latest cycle wins; a running cycle always wins.
		if (
			!existing ||
			display.state === "ongoing" ||
			display.state === "paused" ||
			existing.state === "completed"
		) {
			cells.set(column.column.id, cell);
		}
		result.set(key, cells);
	}
	return result;
}

function cellFor(column: QueueColumn, issue: QueueIssue): QueueCell {
	const href = `/browse/${issue.key}`;
	switch (column.kind) {
		case "key":
			return { ...emptyCell("key"), text: issue.key, href };
		case "summary":
			return { ...emptyCell("summary"), text: issue.summary, href };
		case "type":
			return { ...emptyCell("type"), text: issue.typeName };
		case "status":
			return {
				...emptyCell("status"),
				text: issue.statusName,
				category: issue.statusCategory,
			};
		case "priority":
			return {
				...emptyCell("priority"),
				text: issue.priorityName,
				iconColor: issue.priorityColor,
			};
		case "user":
			return {
				...emptyCell("user"),
				text:
					column.id === "reporter" ? issue.reporterName : issue.assigneeName,
			};
		case "components":
			return {
				...emptyCell("components"),
				text: issue.componentNames.join(", "),
				names: issue.componentNames,
			};
		case "date": {
			const value =
				column.id === "duedate"
					? issue.duedate
					: column.id === "created"
						? (issue.created?.toISOString() ?? null)
						: column.id === "updated"
							? (issue.updated?.toISOString() ?? null)
							: customDate(issue.custom[column.id]);
			return { ...emptyCell("date"), text: value };
		}
		default: {
			if (column.id === "resolution") {
				return { ...emptyCell("text"), text: issue.resolutionName };
			}
			if (column.id === "labels") {
				return {
					...emptyCell("text"),
					text: issue.labels.join(", "),
					names: issue.labels,
				};
			}
			if (column.id === "watchers") {
				return {
					...emptyCell("text"),
					text: issue.watchers.join(", "),
					names: issue.watchers,
				};
			}
			if (column.id === "workratio") {
				return {
					...emptyCell("text"),
					text: issue.workRatio === null ? null : `${issue.workRatio}%`,
				};
			}
			const value = issue.custom[column.id];
			if (column.label === "Customer Request Type") {
				return {
					...emptyCell("text"),
					text: issue.requestTypeName ?? customText(value),
				};
			}
			return { ...emptyCell("text"), text: customText(value) };
		}
	}
}

export async function listQueues(
	desk: Desk,
	user: CurrentUser,
): Promise<QueueListEntry[]> {
	const rows = await db
		.select()
		.from(queues)
		.where(eq(queues.deskId, desk.id))
		.orderBy(asc(queues.sequence));

	return Promise.all(
		rows.map(async (row) => {
			let liveCount: number | null = null;
			try {
				const result = await searchIssues(
					{ jql: row.jql, startAt: 0, maxResults: 1 },
					user,
				);
				liveCount = result.total;
			} catch (error) {
				if (!(error instanceof JqlError)) throw error;
			}
			return {
				id: row.id,
				name: row.name,
				jql: row.jql,
				parentId: row.parentId,
				sequence: row.sequence,
				issueCount: row.issueCount,
				liveCount,
			};
		}),
	);
}

export async function runQueue(
	desk: Desk,
	queueId: string,
	user: CurrentUser,
	options: { startAt: number; maxResults: number; now?: Date },
): Promise<{
	queue: { id: string; name: string; jql: string };
	columns: QueueColumn[];
	startAt: number;
	maxResults: number;
	total: number;
	issues: QueueIssueRow[];
} | null> {
	const [queue] = await db
		.select()
		.from(queues)
		.where(and(eq(queues.deskId, desk.id), eq(queues.id, queueId)))
		.limit(1);
	if (!queue) return null;

	const result = await searchIssues(
		{
			jql: queue.jql,
			startAt: options.startAt,
			maxResults: options.maxResults,
		},
		user,
	);
	const columns = await columnSpecs(desk, queue.columns);
	const issueRows = await loadQueueIssues(
		result.issues.map((issue) => issue.key),
	);
	const sla = await slaCells(
		desk,
		columns,
		issueRows,
		options.now ?? new Date(),
	);

	return {
		queue: { id: queue.id, name: queue.name, jql: queue.jql },
		columns,
		startAt: result.startAt,
		maxResults: result.maxResults,
		total: result.total,
		issues: result.issues.map((issue) => {
			const row = issueRows.get(issue.key);
			const cells: Record<string, QueueCell> = {};
			for (const column of columns) {
				cells[column.id] = row ? cellFor(column, row) : emptyCell(column.kind);
			}
			const slaForIssue = sla.get(issue.key);
			if (slaForIssue) {
				for (const [columnId, cell] of slaForIssue) {
					cells[columnId] = cell;
				}
			}
			return {
				key: issue.key,
				summary: issue.summary,
				cells,
			};
		}),
	};
}
