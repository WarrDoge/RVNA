import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
	boardColumnStatuses,
	boardColumns,
	boardQuickFilters,
	boardSprints,
	boardSwimlanes,
	boards,
	issueSprints,
	issues,
	projects,
	sprintReports,
	sprints,
	statuses,
	users,
} from "../lib/server/schema.ts";
import {
	customFieldId,
	resolveCustomFieldRoles,
} from "../lib/shared/custom-field-roles.ts";
import { pageGuard } from "./client.ts";
import { db } from "./db.ts";
import type { JiraClient } from "./jira.ts";
import { type PrivateApiOptions, skipPrivateApi } from "./private-apis.ts";
import type { JiraField } from "./types.ts";
import { emptyCounts, type ImportCounts } from "./upsert.ts";

type Database = typeof db;

export interface JiraAgileBoard {
	id: number;
	name: string;
	type: "scrum" | "kanban";
}

export interface JiraBoardConfiguration {
	id: number;
	name: string;
	type: "scrum" | "kanban";
	filter?: { id?: string | number };
	columnConfig?: {
		columns?: {
			name: string;
			min?: number | string | null;
			max?: number | string | null;
			statuses?: { id: string }[];
		}[];
	};
	estimation?: {
		type?: string;
		field?: { fieldId?: string; displayName?: string };
	};
	ranking?: { rankCustomFieldId?: number };
}

export interface JiraMappedColumn {
	id?: number;
	name: string;
	min?: number | string | null;
	max?: number | string | null;
	mappedStatuses?: { id: string; name?: string }[];
	isKanPlanColumn?: boolean;
}

export interface JiraEditModel {
	id?: number;
	name?: string;
	filterConfig?: {
		id?: string | number;
		name?: string;
		query?: string;
		owner?: { userName?: string; displayName?: string };
	};
	rapidListConfig?: {
		currentStatisticsField?: {
			typeId?: string;
			fieldId?: string;
			name?: string;
		};
		mappedColumns?: JiraMappedColumn[];
		unmappedStatuses?: { id: string }[];
	};
	swimlanesConfig?: {
		swimlaneStrategy?: string;
		swimlanes?: {
			id?: number;
			name: string;
			query?: string;
			isDefault?: boolean;
		}[];
	};
	quickFilterConfig?: {
		quickFilters?: { id?: number; name: string; query?: string }[];
	};
	subqueryConfig?: {
		subqueries?: { id?: number; query?: string }[];
	};
	estimationStatisticConfig?: {
		currentEstimationStatistic?: {
			typeId?: string;
			fieldId?: string;
			name?: string;
		};
	};
	cardColorConfig?: { cardColorStrategy?: string };
	workingDaysConfig?: {
		weekDays?: Record<string, boolean>;
		nonWorkingDays?: string[];
	};
}

export interface JiraFilter {
	id: string | number;
	name?: string;
	jql?: string;
	owner?: { name?: string; userName?: string; displayName?: string };
	queryProjects?: { projects?: { key: string }[] };
	sharePermissions?: {
		type?: string;
		project?: { key?: string };
	}[];
}

export interface JiraSprint {
	id: number;
	state: string;
	name: string;
	goal?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	completeDate?: string | null;
	activatedDate?: string | null;
	originBoardId?: number;
}

export interface JiraSprintPage {
	values?: JiraSprint[];
	isLast?: boolean;
	startAt?: number;
	maxResults?: number;
	total?: number;
}

export interface JiraAgileIssue {
	id: string;
	key: string;
	fields?: Record<string, unknown>;
}

export interface JiraAgileIssuePage {
	issues?: JiraAgileIssue[];
	total?: number;
	isLast?: boolean;
	startAt?: number;
	maxResults?: number;
}

export interface JiraSprintReportIssue {
	id?: number;
	key: string;
	summary?: string;
	statusId?: string;
	done?: boolean;
}

export interface JiraSprintReportSum {
	text?: string | null;
}

export interface JiraSprintReport {
	sprint?: { id?: number; rapidViewId?: number };
	contents?: {
		completedIssues?: JiraSprintReportIssue[];
		issuesNotCompletedInCurrentSprint?: JiraSprintReportIssue[];
		puntedIssues?: JiraSprintReportIssue[];
		issuesCompletedInAnotherSprint?: JiraSprintReportIssue[];
		issueKeysAddedDuringSprint?: Record<string, boolean>;
		completedIssuesInitialEstimateSum?: JiraSprintReportSum;
		completedIssuesEstimateSum?: JiraSprintReportSum;
		issuesNotCompletedInitialEstimateSum?: JiraSprintReportSum;
		issuesNotCompletedEstimateSum?: JiraSprintReportSum;
		allIssuesEstimateSum?: JiraSprintReportSum;
		puntedIssuesInitialEstimateSum?: JiraSprintReportSum;
		puntedIssuesEstimateSum?: JiraSprintReportSum;
		issuesCompletedInAnotherSprintInitialEstimateSum?: JiraSprintReportSum;
		issuesCompletedInAnotherSprintEstimateSum?: JiraSprintReportSum;
	};
}

export type BoardColumnPlan = {
	name: string;
	minIssues: number | null;
	maxIssues: number | null;
	statusSourceIds: string[];
	kanbanBacklog: boolean;
};

export type BoardConfigPlan = {
	columns: BoardColumnPlan[];
	swimlanes: { name: string; jql: string; sequence: number }[];
	quickFilters: { name: string; jql: string; sequence: number }[];
	subFilterJql: string | null;
	estimationField: "story_points" | "original_estimate" | "issue_count";
	swimlaneStrategy: "none" | "assignee" | "epic" | "queries";
	cardColourStrategy: "none" | "priority" | "assignee" | "epic" | "issue_type";
	kanbanBacklogStatusSourceId: string | null;
	rankCustomFieldId: number | null;
};

const sprintStates: Record<string, "future" | "active" | "closed"> = {
	FUTURE: "future",
	ACTIVE: "active",
	CLOSED: "closed",
};

function integerOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function parseDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function nonEmpty(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function mapSwimlaneStrategy(value: string | undefined) {
	switch (value) {
		case "assignee":
			return "assignee" as const;
		case "epic":
		case "parentChild":
			return "epic" as const;
		case "custom":
		case "queries":
			return "queries" as const;
		default:
			return "none" as const;
	}
}

export function mapCardColourStrategy(value: string | undefined) {
	switch (value) {
		case "priority":
			return "priority" as const;
		case "assignee":
			return "assignee" as const;
		case "epic":
			return "epic" as const;
		case "issueType":
		case "issue_type":
			return "issue_type" as const;
		default:
			return "none" as const;
	}
}

export function mapEstimationField(
	typeId: string | undefined,
	fieldId: string | undefined,
	storyPointsFieldId: string | null,
): "story_points" | "original_estimate" | "issue_count" {
	if (
		typeId === "issueCount" ||
		typeId === "issueCountExclSubs" ||
		typeId === "none" ||
		!fieldId
	) {
		return "issue_count";
	}
	if (fieldId === "timeoriginalestimate") return "original_estimate";
	if (fieldId === storyPointsFieldId) return "story_points";
	return "story_points";
}

/**
 * Maps the two Jira board configuration payloads. The edit model is the
 * authority for the board columns (it carries the kanban backlog column and
 * the column constraints); the agile configuration is the fallback.
 */
export function parseBoardConfig(
	configuration: JiraBoardConfiguration,
	editModel: JiraEditModel,
	storyPointsFieldId: string | null = null,
): BoardConfigPlan {
	const mappedColumns = editModel.rapidListConfig?.mappedColumns;
	const columns: BoardColumnPlan[] = mappedColumns?.length
		? mappedColumns.map((column) => ({
				name: column.name,
				minIssues: integerOrNull(column.min),
				maxIssues: integerOrNull(column.max),
				statusSourceIds: (column.mappedStatuses ?? []).map(
					(status) => status.id,
				),
				kanbanBacklog: column.isKanPlanColumn === true,
			}))
		: (configuration.columnConfig?.columns ?? []).map((column) => ({
				name: column.name,
				minIssues: integerOrNull(column.min),
				maxIssues: integerOrNull(column.max),
				statusSourceIds: (column.statuses ?? []).map((status) => status.id),
				kanbanBacklog: false,
			}));

	const kanbanBacklog = columns.find((column) => column.kanbanBacklog);
	const kanbanBacklogStatusSourceId =
		kanbanBacklog?.statusSourceIds.length === 1
			? (kanbanBacklog.statusSourceIds[0] ?? null)
			: null;

	const quickFilters = (editModel.quickFilterConfig?.quickFilters ?? [])
		.filter((filter) => nonEmpty(filter.query) !== null)
		.map((filter, sequence) => ({
			name: filter.name,
			jql: filter.query?.trim() as string,
			sequence,
		}));

	const swimlanes = (editModel.swimlanesConfig?.swimlanes ?? [])
		.filter(
			(swimlane) =>
				swimlane.isDefault !== true && nonEmpty(swimlane.query) !== null,
		)
		.map((swimlane, sequence) => ({
			name: swimlane.name,
			jql: swimlane.query?.trim() as string,
			sequence,
		}));

	const subqueries = (editModel.subqueryConfig?.subqueries ?? [])
		.map((subquery) => subquery.query?.trim() ?? "")
		.filter(Boolean);

	const estimation =
		editModel.estimationStatisticConfig?.currentEstimationStatistic ??
		configuration.estimation;
	const estimationTypeId =
		(estimation && "typeId" in estimation ? estimation.typeId : undefined) ??
		configuration.estimation?.type;
	const estimationFieldId =
		(estimation && "fieldId" in estimation ? estimation.fieldId : undefined) ??
		configuration.estimation?.field?.fieldId;

	return {
		columns,
		swimlanes,
		quickFilters,
		subFilterJql:
			subqueries.length > 1
				? subqueries.map((query) => `(${query})`).join(" AND ")
				: (subqueries[0] ?? null),
		estimationField: mapEstimationField(
			estimationTypeId,
			estimationFieldId,
			storyPointsFieldId,
		),
		swimlaneStrategy: mapSwimlaneStrategy(
			editModel.swimlanesConfig?.swimlaneStrategy,
		),
		cardColourStrategy: mapCardColourStrategy(
			editModel.cardColorConfig?.cardColorStrategy,
		),
		kanbanBacklogStatusSourceId,
		rankCustomFieldId: configuration.ranking?.rankCustomFieldId ?? null,
	};
}

export function mapSprint(
	sprint: JiraSprint,
	originBoardId: number,
	sequence: number,
) {
	const state = sprintStates[sprint.state?.toUpperCase() ?? ""] ?? "future";
	return {
		sourceId: String(sprint.id),
		boardId: originBoardId,
		name: sprint.name,
		goal: nonEmpty(sprint.goal),
		state,
		startDate: parseDate(sprint.startDate),
		endDate: parseDate(sprint.endDate),
		completeDate: state === "closed" ? parseDate(sprint.completeDate) : null,
		sequence,
	};
}

/** Jira filter JQL project keys, used when the filter payload has no projects. */
export function projectKeysFromJql(jql: string | undefined): string[] {
	if (!jql) return [];
	const keys = new Set<string>();
	for (const match of jql.matchAll(
		/\bproject\s*=\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9_]*))/gi,
	)) {
		const key = match[1] ?? match[2];
		if (key) keys.add(key.trim());
	}
	for (const match of jql.matchAll(/\bproject\s+in\s*\(([^)]*)\)/gi)) {
		const list = match[1];
		if (!list) continue;
		for (const item of list.split(",")) {
			const key = item.trim().replace(/^"|"$/g, "");
			if (/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) keys.add(key);
		}
	}
	return [...keys];
}

export function filterProjectKeys(filter: JiraFilter | null): string[] {
	const keys = new Set<string>();
	for (const project of filter?.queryProjects?.projects ?? []) {
		if (project.key) keys.add(project.key);
	}
	for (const permission of filter?.sharePermissions ?? []) {
		if (permission.type === "project" && permission.project?.key) {
			keys.add(permission.project.key);
		}
	}
	for (const key of projectKeysFromJql(filter?.jql)) keys.add(key);
	return [...keys];
}

export function issueRank(
	issue: JiraAgileIssue,
	rankField: string | number | null,
): string | null {
	const sourceId =
		typeof rankField === "number" ? `customfield_${rankField}` : rankField;
	const value = sourceId
		? issue.fields?.[sourceId as `customfield_${string}`]
		: undefined;
	return typeof value === "string" && value !== "" ? value : null;
}

const boardBuiltinFields = [
	"status",
	"issuetype",
	"timeoriginalestimate",
	"timeestimate",
];

function boardIssueFields(fieldIds: (string | null)[]) {
	return [
		...boardBuiltinFields,
		...fieldIds.filter((id): id is string => id !== null),
	].join(",");
}

async function fetchPaged<T extends { isLast?: boolean }>(
	client: JiraClient,
	path: string,
	params: Record<string, string | number>,
	pick: (page: T) => unknown[],
	maxResults = 100,
): Promise<unknown[]> {
	const values: unknown[] = [];
	const guard = pageGuard(path);
	let startAt = 0;
	for (;;) {
		const page = await client.getJson<T>(path, {
			...params,
			startAt,
			maxResults,
		});
		const pageValues = pick(page);
		guard(pageValues.map((value) => (value as { id?: string | number }).id));
		values.push(...pageValues);
		if (page.isLast === true || pageValues.length === 0) break;
		startAt += pageValues.length;
	}
	return values;
}

export async function fetchBoards(
	client: JiraClient,
): Promise<JiraAgileBoard[]> {
	return (await fetchPaged<{ values?: JiraAgileBoard[]; isLast?: boolean }>(
		client,
		"/rest/agile/1.0/board",
		{},
		(page) => page.values ?? [],
		50,
	)) as JiraAgileBoard[];
}

export async function fetchBoardSprints(
	client: JiraClient,
	boardId: number,
): Promise<JiraSprint[]> {
	try {
		return (await fetchPaged<JiraSprintPage>(
			client,
			`/rest/agile/1.0/board/${boardId}/sprint`,
			{},
			(page) => page.values ?? [],
		)) as JiraSprint[];
	} catch (error) {
		// Jira answers 400 for a kanban board: it has no sprints.
		if (
			error instanceof Error &&
			"status" in error &&
			(error as { status: number }).status === 400
		) {
			return [];
		}
		throw error;
	}
}

export async function fetchBoardIssues(
	client: JiraClient,
	boardId: number,
	fieldIds: (string | null)[] = [],
): Promise<JiraAgileIssue[]> {
	return (await fetchPaged<JiraAgileIssuePage>(
		client,
		`/rest/agile/1.0/board/${boardId}/issue`,
		{ fields: boardIssueFields(fieldIds) },
		(page) => page.issues ?? [],
	)) as JiraAgileIssue[];
}

export async function fetchSprintIssues(
	client: JiraClient,
	sprintId: number,
	fieldIds: (string | null)[] = [],
): Promise<JiraAgileIssue[]> {
	return (await fetchPaged<JiraAgileIssuePage>(
		client,
		`/rest/agile/1.0/sprint/${sprintId}/issue`,
		{ fields: boardIssueFields(fieldIds) },
		(page) => page.issues ?? [],
	)) as JiraAgileIssue[];
}

export async function fetchSprintReport(
	client: JiraClient,
	rapidViewId: number,
	sprintId: number,
): Promise<JiraSprintReport | null> {
	try {
		return await client.getJson<JiraSprintReport>(
			"/rest/greenhopper/1.0/rapid/charts/sprintreport",
			{ rapidViewId, sprintId },
		);
	} catch (error) {
		if (
			error instanceof Error &&
			"status" in error &&
			((error as { status: number }).status === 400 ||
				(error as { status: number }).status === 404)
		) {
			return null;
		}
		throw error;
	}
}

function sameDate(left: Date | null, right: Date | null) {
	if (left === null || right === null) return left === right;
	return left.getTime() === right.getTime();
}

function sameValue(left: unknown, right: unknown): boolean {
	if (left instanceof Date || right instanceof Date) {
		return sameDate(left as Date | null, right as Date | null);
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return JSON.stringify(left) === JSON.stringify(right);
	}
	return left === right;
}

function changed(
	existing: Record<string, unknown>,
	values: Record<string, unknown>,
	keys: string[],
) {
	return keys.some((key) => !sameValue(existing[key], values[key]));
}

async function replaceColumns(
	database: Database,
	boardId: string,
	plan: BoardConfigPlan,
	statusIds: Map<string, string>,
	counts: ImportCounts,
) {
	const existingColumns = await database
		.select()
		.from(boardColumns)
		.where(eq(boardColumns.boardId, boardId));
	const existingMappings = existingColumns.length
		? await database
				.select()
				.from(boardColumnStatuses)
				.where(
					inArray(
						boardColumnStatuses.columnId,
						existingColumns.map((column) => column.id),
					),
				)
		: [];

	const existingPlan = existingColumns
		.sort((left, right) => left.sequence - right.sequence)
		.map((column) => ({
			name: column.name,
			minIssues: column.minIssues,
			maxIssues: column.maxIssues,
			statusSourceIds: existingMappings
				.filter((mapping) => mapping.columnId === column.id)
				.sort((left, right) => left.sequence - right.sequence)
				.map((mapping) => mapping.statusId),
		}));

	const planned = plan.columns.map((column) => ({
		name: column.name,
		minIssues: column.minIssues,
		maxIssues: column.maxIssues,
		statusSourceIds: column.statusSourceIds
			.map((sourceId) => statusIds.get(sourceId))
			.filter((id): id is string => Boolean(id)),
	}));

	if (JSON.stringify(existingPlan) === JSON.stringify(planned)) {
		const columnCounts = counts.board_columns ?? emptyCounts();
		columnCounts.unchanged += planned.length;
		counts.board_columns = columnCounts;
		const statusCounts = counts.board_column_statuses ?? emptyCounts();
		statusCounts.unchanged += planned.reduce(
			(sum, column) => sum + column.statusSourceIds.length,
			0,
		);
		counts.board_column_statuses = statusCounts;
		return;
	}

	if (existingColumns.length > 0) {
		await database
			.delete(boardColumns)
			.where(eq(boardColumns.boardId, boardId));
	}

	for (const [sequence, column] of planned.entries()) {
		const [created] = await database
			.insert(boardColumns)
			.values({
				boardId,
				name: column.name,
				sequence,
				minIssues: column.minIssues,
				maxIssues: column.maxIssues,
			})
			.returning({ id: boardColumns.id });
		if (column.statusSourceIds.length > 0) {
			await database.insert(boardColumnStatuses).values(
				column.statusSourceIds.map((statusId, mappingSequence) => ({
					columnId: created.id,
					statusId,
					sequence: mappingSequence,
				})),
			);
		}
	}
	const statusCount = planned.reduce(
		(sum, column) => sum + column.statusSourceIds.length,
		0,
	);
	const columnCounts = counts.board_columns ?? emptyCounts();
	const statusCounts = counts.board_column_statuses ?? emptyCounts();
	if (existingColumns.length === 0) {
		columnCounts.inserted += planned.length;
		statusCounts.inserted += statusCount;
	} else {
		columnCounts.updated += planned.length;
		statusCounts.updated += statusCount;
	}
	counts.board_columns = columnCounts;
	counts.board_column_statuses = statusCounts;
}

async function replaceSwimlanes(
	database: Database,
	boardId: string,
	plan: BoardConfigPlan,
	counts: ImportCounts,
) {
	const existing = await database
		.select()
		.from(boardSwimlanes)
		.where(eq(boardSwimlanes.boardId, boardId))
		.orderBy(boardSwimlanes.sequence);
	const same =
		existing.length === plan.swimlanes.length &&
		existing.every(
			(row, index) =>
				row.name === plan.swimlanes[index].name &&
				row.jql === plan.swimlanes[index].jql,
		);
	if (same) {
		const current = counts.board_swimlanes ?? emptyCounts();
		current.unchanged += existing.length;
		counts.board_swimlanes = current;
		return;
	}
	if (existing.length > 0) {
		await database
			.delete(boardSwimlanes)
			.where(eq(boardSwimlanes.boardId, boardId));
	}
	if (plan.swimlanes.length > 0) {
		await database
			.insert(boardSwimlanes)
			.values(plan.swimlanes.map((swimlane) => ({ boardId, ...swimlane })));
	}
	const current = counts.board_swimlanes ?? emptyCounts();
	if (existing.length === 0) current.inserted += plan.swimlanes.length;
	else current.updated += plan.swimlanes.length;
	counts.board_swimlanes = current;
}

async function replaceQuickFilters(
	database: Database,
	boardId: string,
	plan: BoardConfigPlan,
	counts: ImportCounts,
) {
	const existing = await database
		.select()
		.from(boardQuickFilters)
		.where(eq(boardQuickFilters.boardId, boardId))
		.orderBy(boardQuickFilters.sequence);
	const same =
		existing.length === plan.quickFilters.length &&
		existing.every(
			(row, index) =>
				row.name === plan.quickFilters[index].name &&
				row.jql === plan.quickFilters[index].jql,
		);
	if (same) {
		const current = counts.board_quick_filters ?? emptyCounts();
		current.unchanged += existing.length;
		counts.board_quick_filters = current;
		return;
	}
	if (existing.length > 0) {
		await database
			.delete(boardQuickFilters)
			.where(eq(boardQuickFilters.boardId, boardId));
	}
	if (plan.quickFilters.length > 0) {
		await database
			.insert(boardQuickFilters)
			.values(plan.quickFilters.map((filter) => ({ boardId, ...filter })));
	}
	const current = counts.board_quick_filters ?? emptyCounts();
	if (existing.length === 0) current.inserted += plan.quickFilters.length;
	else current.updated += plan.quickFilters.length;
	counts.board_quick_filters = current;
}

async function replaceBoardSprints(
	database: Database,
	boardId: string,
	sprintIds: string[],
	counts: ImportCounts,
) {
	const existing = await database
		.select()
		.from(boardSprints)
		.where(eq(boardSprints.boardId, boardId));
	const existingBySprint = new Map(existing.map((row) => [row.sprintId, row]));
	const plannedIds = new Set(sprintIds);
	const stale = existing.filter((row) => !plannedIds.has(row.sprintId));
	if (stale.length > 0) {
		await database.delete(boardSprints).where(
			and(
				eq(boardSprints.boardId, boardId),
				inArray(
					boardSprints.sprintId,
					stale.map((row) => row.sprintId),
				),
			),
		);
	}
	const inserts: { boardId: string; sprintId: string; sequence: number }[] = [];
	const moved: { sprintId: string; sequence: number }[] = [];
	for (const [sequence, sprintId] of sprintIds.entries()) {
		const row = existingBySprint.get(sprintId);
		if (!row) {
			inserts.push({ boardId, sprintId, sequence });
		} else if (row.sequence !== sequence) {
			moved.push({ sprintId, sequence });
		}
	}
	for (const row of moved) {
		await database
			.update(boardSprints)
			.set({ sequence: row.sequence })
			.where(
				and(
					eq(boardSprints.boardId, boardId),
					eq(boardSprints.sprintId, row.sprintId),
				),
			);
	}
	if (inserts.length > 0) {
		await database.insert(boardSprints).values(inserts);
	}
	const current = counts.board_sprints ?? emptyCounts();
	current.inserted += inserts.length;
	current.updated += stale.length + moved.length;
	current.unchanged += existing.length - stale.length - moved.length;
	counts.board_sprints = current;
}

export interface AgileRemoteImportResult {
	counts: ImportCounts;
	boards: number;
	sprints: { future: number; active: number; closed: number };
	issueSprints: number;
	issues: number;
}

export async function importJiraAgile(
	client: JiraClient,
	database: Database = db,
	options: PrivateApiOptions & { overwriteLocal?: boolean } = {},
): Promise<AgileRemoteImportResult> {
	const emptyResult: AgileRemoteImportResult = {
		counts: {},
		boards: 0,
		sprints: { future: 0, active: 0, closed: 0 },
		issueSprints: 0,
		issues: 0,
	};
	if (skipPrivateApi(options, "board configuration and sprint reports")) {
		return emptyResult;
	}
	const jiraFields = await client.getJson<JiraField[]>("/rest/api/2/field");
	const customFields = resolveCustomFieldRoles(
		jiraFields.map((field) => ({
			sourceId: field.id,
			name: field.name,
			type: field.schema?.type ?? null,
			customKey: field.schema?.custom ?? null,
		})),
	);
	const storyPointsId = customFieldId(customFields, "storyPoints");
	const sprintFieldId = customFieldId(customFields, "sprint");
	const rankFieldId = customFieldId(customFields, "rank");
	const issueFieldIds = [sprintFieldId, rankFieldId, storyPointsId];
	const boardList = await fetchBoards(client);
	const boardPlans = await Promise.all(
		boardList.map(async (board) => {
			const configuration = await client.getJson<JiraBoardConfiguration>(
				`/rest/agile/1.0/board/${board.id}/configuration`,
			);
			const [editModel, filter, jiraSprints, boardIssues] = await Promise.all([
				client.getJson<JiraEditModel>(
					"/rest/greenhopper/1.0/rapidviewconfig/editmodel.json",
					{ rapidViewId: board.id },
				),
				configuration.filter?.id
					? client.getJson<JiraFilter>(
							`/rest/api/2/filter/${configuration.filter.id}`,
						)
					: Promise.resolve(null),
				fetchBoardSprints(client, board.id),
				fetchBoardIssues(client, board.id, issueFieldIds),
			]);
			return {
				board,
				configuration,
				editModel,
				filter,
				jiraSprints,
				boardIssues,
			};
		}),
	);

	const allSprintIssues = new Map<number, JiraAgileIssue[]>();
	const sprintIds = new Set<number>();
	for (const plan of boardPlans) {
		for (const sprint of plan.jiraSprints) sprintIds.add(sprint.id);
	}
	const sprintIssueEntries = await Promise.all(
		[...sprintIds].map(async (sprintId) => {
			const sprintIssues = await fetchSprintIssues(
				client,
				sprintId,
				issueFieldIds,
			);
			return [sprintId, sprintIssues] as const;
		}),
	);
	for (const [sprintId, sprintIssues] of sprintIssueEntries) {
		allSprintIssues.set(sprintId, sprintIssues);
	}

	const counts: ImportCounts = {};
	const projectRows = await database
		.select({ id: projects.id, key: projects.key })
		.from(projects);
	const projectIds = new Map(projectRows.map((row) => [row.key, row.id]));
	const userRows = await database
		.select({ id: users.id, username: users.username })
		.from(users);
	const userIds = new Map(userRows.map((row) => [row.username, row.id]));
	const statusRows = await database
		.select({ id: statuses.id, sourceId: statuses.sourceId })
		.from(statuses);
	const statusIds = new Map(statusRows.map((row) => [row.sourceId, row.id]));

	const existingBoards = await database.select().from(boards);
	const existingBoardBySource = new Map(
		existingBoards
			.filter((board) => board.sourceId !== null)
			.map((board) => [board.sourceId as string, board]),
	);
	const existingBoardByRapidView = new Map(
		existingBoards.map((board) => [board.rapidViewId, board]),
	);

	const sprintPlans = new Map<
		number,
		ReturnType<typeof mapSprint> & { originBoardId: number }
	>();
	const boardSprintSourceIds = new Map<number, string[]>();
	for (const plan of boardPlans) {
		const ids: string[] = [];
		for (const [sequence, sprint] of plan.jiraSprints.entries()) {
			ids.push(String(sprint.id));
			const originBoardId = sprint.originBoardId ?? plan.board.id;
			const existing = sprintPlans.get(sprint.id);
			if (!existing || originBoardId === plan.board.id) {
				sprintPlans.set(sprint.id, {
					...mapSprint(sprint, originBoardId, sequence),
					originBoardId,
				});
			}
		}
		boardSprintSourceIds.set(plan.board.id, ids);
	}

	const boardDbIds = new Map<number, string>();
	const boardConfigs = new Map<number, BoardConfigPlan>();
	for (const plan of boardPlans) {
		const config = parseBoardConfig(
			plan.configuration,
			plan.editModel,
			storyPointsId,
		);
		boardConfigs.set(plan.board.id, config);
		const filter = plan.filter;
		const projectKeys = filterProjectKeys(filter);
		const projectId =
			projectKeys.map((key) => projectIds.get(key)).find(Boolean) ?? null;
		const ownerName =
			filter?.owner?.name ?? filter?.owner?.userName ?? undefined;
		const ownerId = ownerName ? (userIds.get(ownerName) ?? null) : null;
		const rapidViewId = plan.board.id;
		const existing =
			existingBoardBySource.get(String(rapidViewId)) ??
			existingBoardByRapidView.get(rapidViewId);
		const values = {
			rapidViewId,
			sourceId: String(rapidViewId),
			name: plan.configuration.name ?? plan.board.name,
			type: plan.board.type,
			filterJql: filter?.jql ?? plan.editModel.filterConfig?.query ?? "",
			projectId,
			estimationField: config.estimationField,
			swimlaneStrategy: config.swimlaneStrategy,
			cardColourStrategy: config.cardColourStrategy,
			subFilterJql: config.subFilterJql,
			kanbanBacklogStatusId: config.kanbanBacklogStatusSourceId
				? (statusIds.get(config.kanbanBacklogStatusSourceId) ?? null)
				: null,
			ownerId,
			configImported: true,
		};
		if (!existing) {
			const [created] = await database
				.insert(boards)
				.values(values)
				.returning({ id: boards.id });
			boardDbIds.set(rapidViewId, created.id);
			const current = counts.boards ?? emptyCounts();
			current.inserted += 1;
			counts.boards = current;
			continue;
		}
		boardDbIds.set(rapidViewId, existing.id);
		const update = changed(existing, values, [
			"rapidViewId",
			"sourceId",
			"name",
			"type",
			"filterJql",
			"projectId",
			"estimationField",
			"swimlaneStrategy",
			"cardColourStrategy",
			"subFilterJql",
			"kanbanBacklogStatusId",
			"ownerId",
			"configImported",
		]);
		const current = counts.boards ?? emptyCounts();
		if (!update) {
			current.unchanged += 1;
		} else {
			await database
				.update(boards)
				.set({ ...values, updatedAt: new Date() })
				.where(eq(boards.id, existing.id));
			current.updated += 1;
		}
		counts.boards = current;
	}

	// A sprint can name an origin board that the token cannot list. Keep it on the
	// board whose sprint list carried it instead of dropping it and its memberships.
	const fallbackBoardBySprint = new Map<string, number>();
	for (const plan of boardPlans) {
		for (const sprint of plan.jiraSprints) {
			const originBoardId = sprint.originBoardId ?? plan.board.id;
			if (!boardDbIds.has(originBoardId) && boardDbIds.has(plan.board.id)) {
				fallbackBoardBySprint.set(String(sprint.id), plan.board.id);
			}
		}
	}

	const sprintIdsBySource = new Map<string, string>();
	for (const sprint of sprintPlans.values()) {
		const dbBoardId = boardDbIds.get(
			fallbackBoardBySprint.get(sprint.sourceId) ?? sprint.boardId,
		);
		if (!dbBoardId) continue;
		const [existing] = await database
			.select()
			.from(sprints)
			.where(eq(sprints.sourceId, sprint.sourceId))
			.limit(1);
		const values = {
			sourceId: sprint.sourceId,
			boardId: dbBoardId,
			name: sprint.name,
			goal: sprint.goal,
			state: sprint.state,
			startDate: sprint.startDate,
			endDate: sprint.endDate,
			completeDate: sprint.completeDate,
			sequence: sprint.sequence,
		};
		if (!existing) {
			const [created] = await database
				.insert(sprints)
				.values(values)
				.returning({ id: sprints.id });
			sprintIdsBySource.set(sprint.sourceId, created.id);
			const current = counts.sprints ?? emptyCounts();
			current.inserted += 1;
			counts.sprints = current;
			continue;
		}
		sprintIdsBySource.set(sprint.sourceId, existing.id);
		const update = changed(existing, values, [
			"boardId",
			"name",
			"goal",
			"state",
			"startDate",
			"endDate",
			"completeDate",
			"sequence",
		]);
		const current = counts.sprints ?? emptyCounts();
		if (!update) {
			current.unchanged += 1;
		} else {
			await database
				.update(sprints)
				.set({ ...values, updatedAt: new Date() })
				.where(eq(sprints.id, existing.id));
			current.updated += 1;
		}
		counts.sprints = current;
	}

	const sprintStateCounts = { future: 0, active: 0, closed: 0 };
	for (const sprint of sprintPlans.values())
		sprintStateCounts[sprint.state] += 1;

	const reportEntries = await Promise.all(
		[...sprintPlans.values()]
			.filter((sprint) => sprint.state === "closed")
			.map(async (sprint) => {
				const report = await fetchSprintReport(
					client,
					sprint.originBoardId,
					Number(sprint.sourceId),
				);
				return { sprint, report };
			}),
	);
	for (const { sprint, report } of reportEntries) {
		if (!report?.contents) continue;
		const dbSprintId = sprintIdsBySource.get(sprint.sourceId);
		if (!dbSprintId) continue;
		const [existing] = await database
			.select()
			.from(sprintReports)
			.where(eq(sprintReports.sprintId, dbSprintId))
			.limit(1);
		const values = {
			sprintId: dbSprintId,
			rapidViewId: sprint.originBoardId,
			contents: report.contents,
		};
		const current = counts.sprint_reports ?? emptyCounts();
		if (!existing) {
			await database.insert(sprintReports).values(values);
			current.inserted += 1;
		} else if (
			isDeepStrictEqual(existing.contents, values.contents) &&
			existing.rapidViewId === values.rapidViewId
		) {
			current.unchanged += 1;
		} else {
			await database
				.update(sprintReports)
				.set({ ...values, fetchedAt: new Date() })
				.where(eq(sprintReports.id, existing.id));
			current.updated += 1;
		}
		counts.sprint_reports = current;
	}

	for (const plan of boardPlans) {
		const boardId = boardDbIds.get(plan.board.id);
		const config = boardConfigs.get(plan.board.id);
		if (!boardId || !config) continue;
		const associationIds = (boardSprintSourceIds.get(plan.board.id) ?? [])
			.map((sourceId) => sprintIdsBySource.get(sourceId))
			.filter((id): id is string => Boolean(id));
		await database.transaction(async (tx) => {
			const transaction = tx as unknown as Database;
			await replaceColumns(transaction, boardId, config, statusIds, counts);
			await replaceSwimlanes(transaction, boardId, config, counts);
			await replaceQuickFilters(transaction, boardId, config, counts);
			await replaceBoardSprints(transaction, boardId, associationIds, counts);
		});
	}

	const issueKeys = new Set<string>();
	for (const plan of boardPlans) {
		for (const issue of plan.boardIssues) issueKeys.add(issue.key);
	}
	for (const sprintIssues of allSprintIssues.values()) {
		for (const issue of sprintIssues) issueKeys.add(issue.key);
	}
	const issueRows = issueKeys.size
		? await database
				.select({
					id: issues.id,
					key: issues.key,
					rank: issues.rank,
					locallyChangedAt: issues.locallyChangedAt,
				})
				.from(issues)
				.where(inArray(issues.key, [...issueKeys]))
		: [];
	const issueIds = new Map(issueRows.map((row) => [row.key, row.id]));
	const rankByKey = new Map<string, string>();
	for (const plan of boardPlans) {
		for (const issue of plan.boardIssues) {
			const rank = issueRank(issue, rankFieldId);
			if (rank) rankByKey.set(issue.key, rank);
		}
	}
	for (const sprintIssues of allSprintIssues.values()) {
		for (const issue of sprintIssues) {
			const rank = issueRank(issue, rankFieldId);
			if (rank) rankByKey.set(issue.key, rank);
		}
	}
	const keptIssueIds = new Set(
		issueRows
			.filter((row) => !options.overwriteLocal && row.locallyChangedAt)
			.map((row) => row.id),
	);
	for (const row of issueRows) {
		if (keptIssueIds.has(row.id)) {
			const current = counts.issues ?? emptyCounts();
			current.unchanged += 1;
			counts.issues = current;
			continue;
		}
		const rank = rankByKey.get(row.key);
		if (!rank || rank === row.rank) {
			const current = counts.issues ?? emptyCounts();
			current.unchanged += 1;
			counts.issues = current;
			continue;
		}
		await database
			.update(issues)
			.set({
				rank,
				updatedAt: new Date(),
				locallyChangedAt: sql`'epoch'::timestamptz`,
			})
			.where(eq(issues.id, row.id));
		const current = counts.issues ?? emptyCounts();
		current.updated += 1;
		counts.issues = current;
	}

	const membership = new Map<
		string,
		{ issueId: string; sprintId: string; isOpen: boolean }
	>();
	for (const [sprintId, sprintIssues] of allSprintIssues) {
		const sprint = sprintPlans.get(sprintId);
		if (!sprint) continue;
		const dbSprintId = sprintIdsBySource.get(String(sprintId));
		if (!dbSprintId) continue;
		for (const issue of sprintIssues) {
			const issueId = issueIds.get(issue.key);
			if (!issueId || keptIssueIds.has(issueId)) continue;
			membership.set(`${issueId}:${dbSprintId}`, {
				issueId,
				sprintId: dbSprintId,
				isOpen: sprint.state !== "closed",
			});
		}
	}

	const sprintStateByDbId = new Map<string, "future" | "active" | "closed">();
	for (const [sourceId, dbId] of sprintIdsBySource) {
		const state = sprintPlans.get(Number(sourceId))?.state;
		if (state) sprintStateByDbId.set(dbId, state);
	}
	const openSprintsByIssue = new Map<
		string,
		{ sprintId: string; state: "future" | "active" | "closed" }
	>();
	for (const row of membership.values()) {
		if (!row.isOpen) continue;
		const state = sprintStateByDbId.get(row.sprintId) ?? "future";
		const current = openSprintsByIssue.get(row.issueId);
		if (!current || (state === "active" && current.state !== "active")) {
			openSprintsByIssue.set(row.issueId, { sprintId: row.sprintId, state });
		}
	}
	for (const row of membership.values()) {
		if (
			row.isOpen &&
			openSprintsByIssue.get(row.issueId)?.sprintId !== row.sprintId
		) {
			row.isOpen = false;
		}
	}

	const importedSprintIds = [...sprintIdsBySource.values()];
	const existingMemberships = importedSprintIds.length
		? await database
				.select()
				.from(issueSprints)
				.where(inArray(issueSprints.sprintId, importedSprintIds))
		: [];
	const existingByKey = new Map(
		existingMemberships.map((row) => [`${row.issueId}:${row.sprintId}`, row]),
	);
	const staleMemberships = existingMemberships.filter(
		(row) =>
			!keptIssueIds.has(row.issueId) &&
			!membership.has(`${row.issueId}:${row.sprintId}`),
	);
	for (const row of staleMemberships) {
		await database
			.delete(issueSprints)
			.where(
				sql`${issueSprints.issueId} = ${row.issueId} and ${issueSprints.sprintId} = ${row.sprintId}`,
			);
	}
	const inserts: {
		issueId: string;
		sprintId: string;
		isOpen: boolean;
	}[] = [];
	const closes: typeof inserts = [];
	const opens: typeof inserts = [];
	let membershipUnchanged = 0;
	let membershipUpdated = 0;
	for (const row of membership.values()) {
		const existing = existingByKey.get(`${row.issueId}:${row.sprintId}`);
		if (!existing) {
			inserts.push(row);
		} else if (existing.isOpen !== row.isOpen) {
			(row.isOpen ? opens : closes).push(row);
		} else {
			membershipUnchanged += 1;
		}
	}
	// The one-open-sprint-per-issue index cannot see both rows of a swap at
	// once, so clear the old open rows before opening the new ones.
	for (const row of [...closes, ...opens]) {
		await database
			.update(issueSprints)
			.set({ isOpen: row.isOpen })
			.where(
				sql`${issueSprints.issueId} = ${row.issueId} and ${issueSprints.sprintId} = ${row.sprintId}`,
			);
		membershipUpdated += 1;
	}
	if (inserts.length > 0) {
		await database.insert(issueSprints).values(inserts);
	}
	counts.issue_sprints = {
		inserted: inserts.length,
		updated: membershipUpdated + staleMemberships.length,
		unchanged: membershipUnchanged,
	};

	return {
		counts,
		boards: boardPlans.length,
		sprints: sprintStateCounts,
		issueSprints: membership.size,
		issues: new Set([...membership.values()].map((row) => row.issueId)).size,
	};
}
