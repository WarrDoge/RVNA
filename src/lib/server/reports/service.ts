import { and, asc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import {
	buildBurndown,
	buildCumulativeFlow,
	buildSprintReport,
	buildVelocity,
	type EstimationStatistic,
	type ReportIssue,
	type SprintEvent,
	type SprintInfo,
	type SprintReportRow,
	type SprintReportSums,
	type StatusCategory,
} from "../../shared/agile-reports/index.ts";
import { JqlError, parseJql } from "../../shared/jql/index.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { loadCatalog } from "../jql/catalog.ts";
import { compileJql, type SearchUser } from "../jql/compile.ts";
import { withStatementTimeout } from "../jql/timeout.ts";
import {
	can,
	projectForId,
	requireBrowseProject,
	viewerProjectIds,
} from "../permissions.ts";
import {
	boardColumnStatuses,
	boardColumns,
	boardSprints,
	boards,
	fields,
	issueFixVersions,
	issueHistory,
	issueHistoryItems,
	issueSprints,
	issues,
	issueTypes,
	projects,
	sprintReports,
	sprints,
	statuses,
	users,
	versions,
} from "../schema.ts";
import type { cfdQuery, reportQuery, velocityQuery } from "./schemas.ts";

type BoardRow = typeof boards.$inferSelect;
type SprintRow = typeof sprints.$inferSelect;
type StatusRow = { id: string; name: string; category: StatusCategory };

type BoardIssueRow = {
	id: string;
	key: string;
	summary: string;
	typeName: string;
	typeSubtask: boolean;
	statusId: string;
	statusName: string;
	statusCategory: StatusCategory;
	assignee: string | null;
	storyPoints: number | null;
	originalEstimate: number | null;
	created: Date | null;
};

type HistoryRow = {
	issueId: string;
	created: Date | null;
	field: string;
	fromString: string | null;
	toString: string | null;
	fromValue: string | null;
	toValue: string | null;
};

type BoardReportData = {
	board: BoardRow;
	issueRows: BoardIssueRow[];
	historyByIssue: Map<string, HistoryRow[]>;
	statusByName: Map<string, StatusRow>;
	sprintRows: SprintRow[];
	storyPointsFieldName: string;
};

function iso(value: Date | null | undefined) {
	return value?.toISOString() ?? null;
}

function sprintPayload(row: SprintRow): SprintInfo & { sequence: number } {
	return {
		id: row.id,
		name: row.name,
		state: row.state,
		startDate: iso(row.startDate),
		endDate: iso(row.endDate),
		completeDate: iso(row.completeDate),
		sequence: row.sequence,
	};
}

async function loadBoard(rapidViewId: number) {
	const [row] = await db
		.select()
		.from(boards)
		.where(eq(boards.rapidViewId, rapidViewId))
		.limit(1);
	return row ?? null;
}

async function loadBoardSprints(boardId: string) {
	return db
		.select()
		.from(sprints)
		.where(
			or(
				eq(sprints.boardId, boardId),
				sql`exists (select 1 from ${boardSprints} bs where bs.sprint_id = ${sprints.id} and bs.board_id = ${boardId})`,
			),
		)
		.orderBy(asc(sprints.sequence), asc(sprints.startDate), asc(sprints.name));
}

async function loadSprint(boardId: string, sprintId: string) {
	const [row] = await db
		.select()
		.from(sprints)
		.where(
			and(
				eq(sprints.id, sprintId),
				or(
					eq(sprints.boardId, boardId),
					sql`exists (select 1 from ${boardSprints} bs where bs.sprint_id = ${sprints.id} and bs.board_id = ${boardId})`,
				),
			),
		)
		.limit(1);
	return row ?? null;
}

async function loadBoardIssueRows(board: BoardRow, user: SearchUser) {
	const conditions: SQL[] = [];
	const catalog = await loadCatalog();
	for (const jql of [board.filterJql, board.subFilterJql]) {
		if (!jql?.trim()) continue;
		const compiled = await compileJql(parseJql(jql), {
			user,
			catalog,
			visibleProjectIds: await viewerProjectIds(user),
		});
		if (compiled.where) conditions.push(compiled.where);
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined;
	const rows = await withStatementTimeout((tx) =>
		tx
			.select({
				id: issues.id,
				key: issues.key,
				summary: issues.summary,
				typeName: issueTypes.name,
				typeSubtask: issueTypes.subtask,
				statusId: statuses.id,
				statusName: statuses.name,
				statusCategory: statuses.category,
				assignee: users.displayName,
				storyPoints: issues.storyPoints,
				originalEstimate: issues.originalEstimate,
				created: issues.created,
			})
			.from(issues)
			.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
			.innerJoin(statuses, eq(statuses.id, issues.statusId))
			.leftJoin(users, eq(users.id, issues.assigneeId))
			.where(where)
			.orderBy(sql`${issues.rank} collate "C"`, issues.key),
	);
	return rows as BoardIssueRow[];
}

async function loadHistoryRows(issueIds: string[]): Promise<HistoryRow[]> {
	if (issueIds.length === 0) return [];
	const rows = await db
		.select({
			issueId: issueHistory.issueId,
			created: issueHistory.created,
			field: issueHistoryItems.field,
			fromString: issueHistoryItems.fromText,
			toString: issueHistoryItems.toText,
			fromValue: issueHistoryItems.fromValue,
			toValue: issueHistoryItems.toValue,
		})
		.from(issueHistoryItems)
		.innerJoin(issueHistory, eq(issueHistory.id, issueHistoryItems.historyId))
		.where(inArray(issueHistory.issueId, issueIds))
		.orderBy(asc(issueHistory.created), asc(issueHistoryItems.sequence));
	return rows as HistoryRow[];
}

async function storyPointsFieldName() {
	const [row] = await db
		.select({ name: fields.name })
		.from(fields)
		.where(sql`lower(${fields.name}) = 'story points'`)
		.limit(1);
	return row?.name ?? "Story Points";
}

async function loadBoardReportData(
	board: BoardRow,
	user: SearchUser,
): Promise<BoardReportData> {
	const [issueRows, statusRows, sprintRows, storyPointsName] =
		await Promise.all([
			loadBoardIssueRows(board, user),
			db
				.select({
					id: statuses.id,
					name: statuses.name,
					category: statuses.category,
				})
				.from(statuses),
			loadBoardSprints(board.id),
			storyPointsFieldName(),
		]);
	const historyRows = await loadHistoryRows(issueRows.map((row) => row.id));
	const historyByIssue = new Map<string, HistoryRow[]>();
	for (const row of historyRows) {
		const list = historyByIssue.get(row.issueId) ?? [];
		list.push(row);
		historyByIssue.set(row.issueId, list);
	}
	return {
		board,
		issueRows,
		historyByIssue,
		statusByName: new Map(statusRows.map((row) => [row.name, row])),
		sprintRows,
		storyPointsFieldName: storyPointsName,
	};
}

function parseSprintNames(value: string | null, names: string[]): string[] {
	if (!value?.trim()) return [];
	const sorted = [...names].sort((left, right) => right.length - left.length);
	const result: string[] = [];
	let rest = value.trim();
	for (let guard = 0; guard < 100 && rest.length > 0; guard += 1) {
		const match = sorted.find((name) => rest.startsWith(name));
		if (match) {
			result.push(match);
			rest = rest.slice(match.length).replace(/^[,\s]+/, "");
			continue;
		}
		const comma = rest.indexOf(",");
		if (comma < 0) {
			result.push(rest.trim());
			break;
		}
		result.push(rest.slice(0, comma).trim());
		rest = rest.slice(comma + 1).trim();
	}
	return result.filter(Boolean);
}

function matchesTargetSprint(
	name: string,
	at: Date | null,
	target: SprintRow,
	allSprints: SprintRow[],
) {
	if (name !== target.name) return false;
	const duplicates = allSprints.filter((sprint) => sprint.name === name);
	if (duplicates.length <= 1) return true;
	const other = duplicates.find((sprint) => sprint.id !== target.id);
	if (!other) return true;
	if (target.state !== "future" && other.state === "future") return true;
	if (target.state === "future" && other.state !== "future") return false;
	if (!at || !target.startDate || !target.endDate) return true;
	const time = at.getTime();
	const targetEnd = (target.completeDate ?? target.endDate).getTime();
	const otherEnd = (other.completeDate ?? other.endDate)?.getTime();
	if (otherEnd === undefined) return true;
	return time >= target.startDate.getTime() && time <= targetEnd
		? !(time >= (other.startDate?.getTime() ?? 0) && time <= otherEnd)
		: false;
}

function estimateValue(row: HistoryRow): {
	from: number | null;
	to: number | null;
} {
	const parse = (value: string | null, text: string | null) => {
		const raw = value ?? text;
		if (raw === null || raw === "") return null;
		const number = Number(raw);
		return Number.isFinite(number) ? number : null;
	};
	return {
		from: parse(row.fromValue, row.fromString),
		to: parse(row.toValue, row.toString),
	};
}

function estimationFieldNames(
	estimation: EstimationStatistic,
	storyPointsName: string,
): string[] {
	if (estimation === "story_points") return [storyPointsName];
	if (estimation === "original_estimate") return ["timeoriginalestimate"];
	return [];
}

type SprintSnapshot = {
	completed: Set<string>;
	notCompleted: Set<string>;
	punted: Set<string>;
	added: Set<string>;
	sums: Partial<SprintReportSums>;
};

function parseJiraSum(
	value: { text?: string | null } | undefined,
	estimation: EstimationStatistic,
): number | null {
	const text = value?.text?.trim();
	if (!text || text === "null") return null;
	const numeric = Number(text);
	if (Number.isFinite(numeric)) return numeric;
	if (estimation !== "original_estimate") return null;
	let total = 0;
	let matched = false;
	for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*([wdhm])/g)) {
		matched = true;
		const amount = Number(match[1]);
		const unit = match[2];
		total +=
			unit === "w"
				? amount * 5 * 8 * 3600
				: unit === "d"
					? amount * 8 * 3600
					: unit === "h"
						? amount * 3600
						: amount * 60;
	}
	return matched ? total : null;
}

function parseSnapshot(
	contents: Record<string, unknown>,
	estimation: EstimationStatistic,
): SprintSnapshot {
	const listKeys = (key: string) =>
		new Set(
			((contents[key] as { key?: string }[] | undefined) ?? [])
				.map((item) => item.key)
				.filter((value): value is string => Boolean(value)),
		);
	const sum = (key: string) =>
		parseJiraSum(
			contents[key] as { text?: string | null } | undefined,
			estimation,
		);
	const sums: Partial<SprintReportSums> = {};
	const assign = (target: keyof SprintReportSums, value: number | null) => {
		if (value !== null) sums[target] = value;
	};
	assign("completedInitial", sum("completedIssuesInitialEstimateSum"));
	assign("completedCurrent", sum("completedIssuesEstimateSum"));
	assign("notCompletedInitial", sum("issuesNotCompletedInitialEstimateSum"));
	assign("notCompletedCurrent", sum("issuesNotCompletedEstimateSum"));
	assign("removedInitial", sum("puntedIssuesInitialEstimateSum"));
	assign("removedCurrent", sum("puntedIssuesEstimateSum"));
	assign("totalInitial", sum("allIssuesEstimateSum"));
	if (
		sums.completedCurrent !== undefined &&
		sums.notCompletedCurrent !== undefined
	) {
		sums.totalCurrent = sums.completedCurrent + sums.notCompletedCurrent;
	}
	return {
		completed: listKeys("completedIssues"),
		notCompleted: listKeys("issuesNotCompletedInCurrentSprint"),
		punted: new Set([
			...listKeys("puntedIssues"),
			...listKeys("issuesCompletedInAnotherSprint"),
		]),
		added: new Set(
			Object.keys(
				(contents.issueKeysAddedDuringSprint as
					| Record<string, boolean>
					| undefined) ?? {},
			),
		),
		sums,
	};
}

async function buildSprintData(
	data: BoardReportData,
	sprint: SprintRow,
	estimation: EstimationStatistic,
) {
	const [reportRow] = await db
		.select()
		.from(sprintReports)
		.where(eq(sprintReports.sprintId, sprint.id))
		.limit(1);
	const snapshot = reportRow
		? parseSnapshot(reportRow.contents as Record<string, unknown>, estimation)
		: null;
	const names = data.sprintRows.map((row) => row.name);
	const events: SprintEvent[] = [];
	const candidateIds = new Set<string>();

	for (const issue of data.issueRows) {
		if (issue.typeSubtask) continue;
		const history = data.historyByIssue.get(issue.id) ?? [];
		const sprintHistory = history.filter((row) => row.field === "Sprint");
		for (const row of sprintHistory) {
			const fromNames = parseSprintNames(row.fromString, names);
			const toNames = parseSprintNames(row.toString, names);
			const inFrom = fromNames.some((name) =>
				matchesTargetSprint(name, row.created, sprint, data.sprintRows),
			);
			const inTo = toNames.some((name) =>
				matchesTargetSprint(name, row.created, sprint, data.sprintRows),
			);
			if (inTo && !inFrom) {
				candidateIds.add(issue.id);
				events.push({
					at:
						iso(row.created) ??
						sprint.startDate?.toISOString() ??
						new Date().toISOString(),
					type: "scope-added",
					issueId: issue.id,
					issueKey: issue.key,
				});
			}
			if (inFrom && !inTo) {
				candidateIds.add(issue.id);
				events.push({
					at:
						iso(row.created) ??
						sprint.startDate?.toISOString() ??
						new Date().toISOString(),
					type: "scope-removed",
					issueId: issue.id,
					issueKey: issue.key,
				});
			}
		}
	}

	const membership = await db
		.select({ issueId: issueSprints.issueId })
		.from(issueSprints)
		.where(eq(issueSprints.sprintId, sprint.id));
	const issueById = new Map(data.issueRows.map((row) => [row.id, row]));
	const currentMembers = new Set(
		membership
			.map((row) => row.issueId)
			.filter((issueId) => !issueById.get(issueId)?.typeSubtask),
	);
	for (const issueId of currentMembers) candidateIds.add(issueId);
	const reportIssues: ReportIssue[] = [];
	for (const issueId of candidateIds) {
		const issue = issueById.get(issueId);
		if (!issue) continue;
		const history = data.historyByIssue.get(issueId) ?? [];
		const sprintEvents = events.filter((event) => event.issueId === issueId);
		const currentlyInSprint = currentMembers.has(issueId);
		const start = sprint.startDate ?? sprint.endDate ?? new Date();
		const end = sprint.completeDate ?? sprint.endDate ?? new Date();
		const created = issue.created ?? start;

		if (sprintEvents.length === 0) {
			events.push({
				at: created > start ? created.toISOString() : start.toISOString(),
				type: "scope-added",
				issueId,
				issueKey: issue.key,
			});
		} else if (currentlyInSprint) {
			const lastScope = [...sprintEvents]
				.sort((left, right) => left.at.localeCompare(right.at))
				.at(-1);
			if (lastScope?.type === "scope-removed" && sprint.state !== "closed") {
				events.push({
					at: end.toISOString(),
					type: "scope-added",
					issueId,
					issueKey: issue.key,
				});
			}
		} else {
			const lastScope = [...sprintEvents]
				.sort((left, right) => left.at.localeCompare(right.at))
				.at(-1);
			if (lastScope?.type === "scope-added") {
				events.push({
					at: end.toISOString(),
					type: "scope-removed",
					issueId,
					issueKey: issue.key,
				});
			}
		}

		const estimate =
			estimation === "issue_count"
				? 1
				: estimation === "story_points"
					? (issue.storyPoints ?? 0)
					: (issue.originalEstimate ?? 0);
		reportIssues.push({
			id: issue.id,
			key: issue.key,
			summary: issue.summary,
			typeName: issue.typeName,
			status: {
				id: issue.statusId,
				name: issue.statusName,
				category: issue.statusCategory,
			},
			assignee: issue.assignee,
			estimate,
			created: iso(issue.created),
		});

		for (const row of history) {
			if (row.field === "status" && row.created) {
				const from = data.statusByName.get(row.fromString ?? "");
				const to = data.statusByName.get(row.toString ?? "");
				if (!from || !to) continue;
				events.push({
					at: row.created.toISOString(),
					type: "status-changed",
					issueId,
					issueKey: issue.key,
					fromCategory: from.category,
					toCategory: to.category,
				});
			}
			if (
				estimationFieldNames(estimation, data.storyPointsFieldName).includes(
					row.field,
				) &&
				row.created
			) {
				const value = estimateValue(row);
				if (value.from !== value.to) {
					events.push({
						at: row.created.toISOString(),
						type: "estimate-changed",
						issueId,
						issueKey: issue.key,
						from: value.from,
						to: value.to,
					});
				}
			}
		}
		if (issue.created) {
			events.push({
				at: issue.created.toISOString(),
				type: "issue-created",
				issueId,
				issueKey: issue.key,
			});
		}
	}

	if (snapshot) {
		const allowed = new Set([
			...snapshot.completed,
			...snapshot.notCompleted,
			...snapshot.punted,
		]);
		for (let index = reportIssues.length - 1; index >= 0; index -= 1) {
			if (!allowed.has(reportIssues[index].key)) reportIssues.splice(index, 1);
		}
		const end = sprint.completeDate ?? sprint.endDate ?? new Date();
		const start = sprint.startDate ?? end;
		const addedKeys = snapshot.added;
		const endKeys = new Set([...snapshot.completed, ...snapshot.notCompleted]);
		for (const issue of reportIssues) {
			const issueEvents = events
				.filter((event) => event.issueId === issue.id)
				.sort((left, right) => left.at.localeCompare(right.at));
			const lastScope = [...issueEvents]
				.reverse()
				.find(
					(event) =>
						event.type === "scope-added" || event.type === "scope-removed",
				);
			if (snapshot.punted.has(issue.key) && !endKeys.has(issue.key)) {
				if (lastScope?.type !== "scope-removed") {
					events.push({
						at: end.toISOString(),
						type: "scope-removed",
						issueId: issue.id,
						issueKey: issue.key,
					});
				}
			}
			if (endKeys.has(issue.key) && lastScope?.type === "scope-removed") {
				events.push({
					at: end.toISOString(),
					type: "scope-added",
					issueId: issue.id,
					issueKey: issue.key,
				});
			}
			if (addedKeys.has(issue.key)) {
				const addedAfterStart = issueEvents.some(
					(event) =>
						event.type === "scope-added" &&
						new Date(event.at).getTime() > new Date(start).getTime(),
				);
				if (!addedAfterStart) {
					events.push({
						at: new Date(new Date(start).getTime() + 1).toISOString(),
						type: "scope-added",
						issueId: issue.id,
						issueKey: issue.key,
					});
				}
			}
			const statusAtEnd = issue.status.category;
			if (snapshot.completed.has(issue.key) && statusAtEnd !== "done") {
				events.push({
					at: end.toISOString(),
					type: "status-changed",
					issueId: issue.id,
					issueKey: issue.key,
					fromCategory: statusAtEnd,
					toCategory: "done",
				});
			}
			if (snapshot.notCompleted.has(issue.key) && statusAtEnd === "done") {
				events.push({
					at: end.toISOString(),
					type: "status-changed",
					issueId: issue.id,
					issueKey: issue.key,
					fromCategory: "done",
					toCategory: "indeterminate",
				});
			}
		}
	}

	return { issues: reportIssues, events, snapshot };
}

function reportIssuePayload(issue: ReportIssue) {
	return {
		id: issue.id,
		key: issue.key,
		summary: issue.summary,
		typeName: issue.typeName,
		status: issue.status,
		assignee: issue.assignee,
		estimate: issue.estimate,
		created: issue.created,
	};
}

function rowPayload(row: SprintReportRow) {
	return {
		issue: reportIssuePayload(row.issue),
		estimateAtStart: row.estimateAtStart,
		estimateAtEnd: row.estimateAtEnd,
		estimateAtRemoval: row.estimateAtRemoval,
		statusAtEnd: row.statusAtEnd,
		addedDuringSprint: row.addedDuringSprint,
		completedAt: row.completedAt,
	};
}

function jqlFailure(error: unknown): never {
	if (error instanceof JqlError) throw new HttpError(400, error.jiraMessage);
	throw error;
}

async function requireReportBoard(user: CurrentUser, rapidViewId: number) {
	const board = await loadBoard(rapidViewId);
	if (!board) throw new HttpError(404, "Board not found");
	if (!board.projectId) return board;
	const project = await projectForId(board.projectId);
	if (!project || !(await can(user, "BROWSE_PROJECTS", project))) {
		throw new HttpError(404, "Board not found");
	}
	return board;
}

async function sprintForRequest(
	board: BoardRow,
	sprintId: string | undefined,
	prefer: "last-closed" | "active" = "last-closed",
) {
	const sprintRows = await loadBoardSprints(board.id);
	if (sprintId) {
		const sprint = sprintRows.find((row) => row.id === sprintId);
		if (sprint) return { sprint, sprintRows };
		const direct = await loadSprint(board.id, sprintId);
		return { sprint: direct, sprintRows };
	}
	const closed = sprintRows
		.filter((row) => row.state === "closed")
		.sort(
			(left, right) =>
				(
					right.completeDate ??
					right.endDate ??
					right.startDate ??
					new Date(0)
				).getTime() -
				(
					left.completeDate ??
					left.endDate ??
					left.startDate ??
					new Date(0)
				).getTime(),
		);
	const active = sprintRows.find((row) => row.state === "active");
	const sprint =
		prefer === "active" ? (active ?? closed[0]) : (closed[0] ?? active);
	return { sprint: sprint ?? null, sprintRows };
}

export async function listBoardSprintReports(
	actor: CurrentUser,
	rapidViewId: number,
) {
	const board = await requireReportBoard(actor, rapidViewId);
	const sprintRows = await loadBoardSprints(board.id);
	return {
		board: {
			id: board.id,
			rapidViewId: board.rapidViewId,
			name: board.name,
			type: board.type,
			estimationField: board.estimationField,
		},
		sprints: sprintRows.map(sprintPayload),
	};
}

export async function burndownReport(
	actor: CurrentUser,
	rapidViewId: number,
	query: z.infer<typeof reportQuery>,
) {
	const board = await requireReportBoard(actor, rapidViewId);
	const { sprint, sprintRows } = await sprintForRequest(
		board,
		query.sprintId,
		"active",
	);
	if (!sprint) throw new HttpError(404, "Sprint not found");
	const estimation = query.estimation ?? board.estimationField;
	try {
		const data = await loadBoardReportData(board, actor);
		const sprintData = await buildSprintData(data, sprint, estimation);
		const burndown = buildBurndown({
			start: sprint.startDate?.toISOString() ?? new Date().toISOString(),
			end:
				sprint.endDate?.toISOString() ??
				sprint.completeDate?.toISOString() ??
				new Date().toISOString(),
			completeAt: sprint.completeDate?.toISOString() ?? null,
			issues: sprintData.issues,
			events: sprintData.events,
		});
		return {
			board: {
				rapidViewId: board.rapidViewId,
				name: board.name,
				type: board.type,
			},
			sprint: sprintPayload(sprint),
			estimation,
			sprints: sprintRows.map(sprintPayload),
			...burndown,
		};
	} catch (error) {
		jqlFailure(error);
	}
}

export async function sprintReport(
	actor: CurrentUser,
	rapidViewId: number,
	query: z.infer<typeof reportQuery>,
) {
	const board = await requireReportBoard(actor, rapidViewId);
	const { sprint, sprintRows } = await sprintForRequest(
		board,
		query.sprintId,
		"last-closed",
	);
	if (!sprint) throw new HttpError(404, "Sprint not found");
	const estimation = query.estimation ?? board.estimationField;
	try {
		const data = await loadBoardReportData(board, actor);
		const sprintData = await buildSprintData(data, sprint, estimation);
		const report = buildSprintReport({
			sprint: sprintPayload(sprint),
			issues: sprintData.issues,
			events: sprintData.events,
		});
		const burndown = buildBurndown({
			start: sprint.startDate?.toISOString() ?? new Date().toISOString(),
			end:
				sprint.endDate?.toISOString() ??
				sprint.completeDate?.toISOString() ??
				new Date().toISOString(),
			completeAt: sprint.completeDate?.toISOString() ?? null,
			issues: sprintData.issues,
			events: sprintData.events,
		});
		const useSnapshotSums = estimation === board.estimationField;
		const sums = {
			...report.sums,
			...(useSnapshotSums ? sprintData.snapshot?.sums : {}),
		};
		return {
			board: {
				rapidViewId: board.rapidViewId,
				name: board.name,
				type: board.type,
			},
			sprint: sprintPayload(sprint),
			estimation,
			sprints: sprintRows.map(sprintPayload),
			burndown,
			completed: report.completed.map(rowPayload),
			notCompleted: report.notCompleted.map(rowPayload),
			removed: report.removed.map(rowPayload),
			addedDuringSprint: sprintData.snapshot
				? [...sprintData.snapshot.added].sort()
				: report.addedDuringSprint,
			sums,
		};
	} catch (error) {
		jqlFailure(error);
	}
}

export async function velocityReport(
	actor: CurrentUser,
	rapidViewId: number,
	query: z.infer<typeof velocityQuery>,
) {
	const board = await requireReportBoard(actor, rapidViewId);
	const estimation = query.estimation ?? board.estimationField;
	try {
		const data = await loadBoardReportData(board, actor);
		const useSnapshotSums = estimation === board.estimationField;
		const closed = data.sprintRows.filter(
			(row) => row.state === "closed" && row.startDate,
		);
		const velocitySprints = [];
		for (const sprint of closed) {
			const sprintData = await buildSprintData(data, sprint, estimation);
			const report = buildSprintReport({
				sprint: sprintPayload(sprint),
				issues: sprintData.issues,
				events: sprintData.events,
			});
			velocitySprints.push({
				id: sprint.id,
				name: sprint.name,
				startDate: iso(sprint.startDate),
				endDate: iso(sprint.endDate),
				completeDate: iso(sprint.completeDate),
				commitment: useSnapshotSums
					? (sprintData.snapshot?.sums.totalInitial ?? report.sums.totalInitial)
					: report.sums.totalInitial,
				completed: useSnapshotSums
					? (sprintData.snapshot?.sums.completedCurrent ??
						report.sums.completedCurrent)
					: report.sums.completedCurrent,
			});
		}
		const velocity = buildVelocity(velocitySprints);
		return {
			board: {
				rapidViewId: board.rapidViewId,
				name: board.name,
				type: board.type,
			},
			estimation,
			...velocity,
		};
	} catch (error) {
		jqlFailure(error);
	}
}

export async function cumulativeFlowReport(
	actor: CurrentUser,
	rapidViewId: number,
	query: z.infer<typeof cfdQuery>,
) {
	const board = await requireReportBoard(actor, rapidViewId);
	try {
		const data = await loadBoardReportData(board, actor);
		const columnRows = await db
			.select({
				id: boardColumns.id,
				name: boardColumns.name,
				sequence: boardColumns.sequence,
				statusId: boardColumnStatuses.statusId,
			})
			.from(boardColumns)
			.leftJoin(
				boardColumnStatuses,
				eq(boardColumnStatuses.columnId, boardColumns.id),
			)
			.where(eq(boardColumns.boardId, board.id))
			.orderBy(asc(boardColumns.sequence), asc(boardColumnStatuses.sequence));
		const columns = new Map<
			string,
			{ id: string; name: string; sequence: number; statusIds: string[] }
		>();
		for (const row of columnRows) {
			const column = columns.get(row.id) ?? {
				id: row.id,
				name: row.name,
				sequence: row.sequence,
				statusIds: [],
			};
			if (row.statusId) column.statusIds.push(row.statusId);
			columns.set(row.id, column);
		}
		const statusIdByName = new Map(
			[...data.statusByName.values()].map((row) => [row.name, row.id]),
		);
		const to = query.to ?? new Date().toISOString().slice(0, 10);
		const from =
			query.from ??
			new Date(Date.now() - 13 * 24 * 60 * 60 * 1000)
				.toISOString()
				.slice(0, 10);
		const fromDate = new Date(`${from}T00:00:00.000Z`);
		const toDate = new Date(`${to}T00:00:00.000Z`);
		if (
			Number.isNaN(fromDate.getTime()) ||
			Number.isNaN(toDate.getTime()) ||
			toDate < fromDate ||
			toDate.getTime() - fromDate.getTime() > 90 * 24 * 60 * 60 * 1000
		) {
			throw new HttpError(400, "Invalid date range");
		}
		const cfdIssues = data.issueRows
			.filter((issue) => !query.assignee || issue.assignee === query.assignee)
			.map((issue) => {
				const history = (data.historyByIssue.get(issue.id) ?? []).filter(
					(row) => row.field === "status" && row.created,
				);
				const statusChanges = [];
				for (const row of history) {
					const fromStatusId = statusIdByName.get(row.fromString ?? "");
					const toStatusId = statusIdByName.get(row.toString ?? "");
					if (!toStatusId) continue;
					statusChanges.push({
						at: row.created?.toISOString() as string,
						fromStatusId: fromStatusId ?? null,
						toStatusId,
					});
				}
				return {
					id: issue.id,
					key: issue.key,
					created: iso(issue.created),
					statusId: issue.statusId,
					statusChanges,
				};
			});
		const flow = buildCumulativeFlow({
			from,
			to,
			columns: [...columns.values()],
			issues: cfdIssues,
		});
		const assignees = [
			...new Set(
				data.issueRows
					.map((issue) => issue.assignee)
					.filter((value): value is string => Boolean(value)),
			),
		].sort();
		return {
			board: {
				rapidViewId: board.rapidViewId,
				name: board.name,
				type: board.type,
			},
			from,
			to,
			columns: [...columns.values()],
			assignees,
			...flow,
		};
	} catch (error) {
		jqlFailure(error);
	}
}

export async function listProjectReleases(actor: CurrentUser, key: string) {
	const [project] = await db
		.select({ id: projects.id, key: projects.key, name: projects.name })
		.from(projects)
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	if (!project) throw new HttpError(404, "Project not found");
	await requireBrowseProject(actor, project.id);
	const versionRows = await db
		.select()
		.from(versions)
		.where(eq(versions.projectId, project.id))
		.orderBy(asc(versions.sequence), asc(versions.name));
	const counts = await db
		.select({
			versionId: issueFixVersions.versionId,
			category: statuses.category,
			count: sql<number>`count(*)::int`,
		})
		.from(issueFixVersions)
		.innerJoin(issues, eq(issues.id, issueFixVersions.issueId))
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.where(eq(issues.projectId, project.id))
		.groupBy(issueFixVersions.versionId, statuses.category);
	const byVersion = new Map<string, Record<StatusCategory, number>>();
	for (const row of counts) {
		const entry = byVersion.get(row.versionId) ?? {
			new: 0,
			indeterminate: 0,
			done: 0,
		};
		entry[row.category] = row.count;
		byVersion.set(row.versionId, entry);
	}
	return {
		project: { key: project.key, name: project.name },
		versions: versionRows.map((row) => {
			const entry = byVersion.get(row.id) ?? {
				new: 0,
				indeterminate: 0,
				done: 0,
			};
			return {
				id: row.id,
				name: row.name,
				description: row.description,
				released: row.released,
				archived: row.archived,
				startDate: row.startDate,
				releaseDate: row.releaseDate,
				counts: entry,
				total: entry.new + entry.indeterminate + entry.done,
			};
		}),
	};
}

export async function getProjectVersion(
	actor: CurrentUser,
	key: string,
	versionId: string,
) {
	const [project] = await db
		.select({ id: projects.id, key: projects.key, name: projects.name })
		.from(projects)
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	if (!project) throw new HttpError(404, "Project not found");
	await requireBrowseProject(actor, project.id);
	const [version] = await db
		.select()
		.from(versions)
		.where(and(eq(versions.id, versionId), eq(versions.projectId, project.id)))
		.limit(1);
	if (!version) throw new HttpError(404, "Version not found");
	const issueRows = await db
		.select({
			id: issues.id,
			key: issues.key,
			summary: issues.summary,
			typeName: issueTypes.name,
			statusId: statuses.id,
			statusName: statuses.name,
			statusCategory: statuses.category,
			assignee: users.displayName,
		})
		.from(issueFixVersions)
		.innerJoin(issues, eq(issues.id, issueFixVersions.issueId))
		.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(users, eq(users.id, issues.assigneeId))
		.where(eq(issueFixVersions.versionId, version.id))
		.orderBy(sql`${issues.rank} collate "C"`, issues.key);
	const counts = { new: 0, indeterminate: 0, done: 0 };
	for (const row of issueRows) counts[row.statusCategory] += 1;
	return {
		project: { key: project.key, name: project.name },
		version: {
			id: version.id,
			name: version.name,
			description: version.description,
			released: version.released,
			archived: version.archived,
			startDate: version.startDate,
			releaseDate: version.releaseDate,
			counts,
			total: issueRows.length,
		},
		issues: issueRows.map((row) => ({
			id: row.id,
			key: row.key,
			summary: row.summary,
			typeName: row.typeName,
			status: {
				id: row.statusId,
				name: row.statusName,
				category: row.statusCategory,
			},
			assignee: row.assignee,
		})),
	};
}
