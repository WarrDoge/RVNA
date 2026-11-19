import { and, eq, inArray, sql } from "drizzle-orm";
import { parseJql } from "../../shared/jql/index.ts";
import {
	computeSlaCycles,
	type SlaCalendar,
	type SlaCycle,
	type SlaEvent,
} from "../../shared/sla/index.ts";
import { db } from "../db.ts";
import { loadCatalog } from "../jql/catalog.ts";
import { ALL_PROJECTS, compileJql } from "../jql/compile.ts";
import {
	comments,
	issueHistory,
	issueHistoryItems,
	issues,
	serviceDesks,
	slaCalendars,
	slaCycles,
	slaGoals,
	slaMetrics,
} from "../schema.ts";

export interface RebuildOptions {
	issueIds?: string[];
	now?: Date;
}

export interface RebuildResult {
	issues: number;
	cycles: number;
}

interface IssueRow {
	id: string;
	projectId: string;
	created: Date | null;
	reporterId: string | null;
}

interface EventRow {
	issueId: string;
	at: number;
	rank: number;
	sequence: number;
	event: SlaEvent;
}

function eventRows(
	issueRows: IssueRow[],
	commentRows: {
		issueId: string;
		authorId: string | null;
		internal: boolean;
		created: Date | null;
	}[],
	historyRows: {
		issueId: string;
		created: Date | null;
		sequence: number;
		field: string;
		toValue: string | null;
	}[],
) {
	const byIssue = new Map<string, EventRow[]>();
	const push = (issueId: string, row: EventRow) => {
		const list = byIssue.get(issueId) ?? [];
		list.push(row);
		byIssue.set(issueId, list);
	};

	for (const issue of issueRows) {
		if (issue.created) {
			push(issue.id, {
				issueId: issue.id,
				at: issue.created.getTime(),
				rank: 0,
				sequence: 0,
				event: { kind: "created", at: issue.created },
			});
		}
	}

	for (const row of historyRows) {
		if (!row.created) continue;
		const at = row.created.getTime();
		if (row.field === "status" && row.toValue) {
			push(row.issueId, {
				issueId: row.issueId,
				at,
				rank: 1,
				sequence: row.sequence,
				event: { kind: "status", at: row.created, statusId: row.toValue },
			});
		} else if (row.field === "assignee") {
			push(row.issueId, {
				issueId: row.issueId,
				at,
				rank: 1,
				sequence: row.sequence,
				event: {
					kind: "assignee",
					at: row.created,
					assigneeId: row.toValue || null,
				},
			});
		} else if (row.field === "resolution") {
			push(row.issueId, {
				issueId: row.issueId,
				at,
				rank: 1,
				sequence: row.sequence,
				event: {
					kind: "resolution",
					at: row.created,
					resolutionId: row.toValue || null,
				},
			});
		}
	}

	const reporters = new Map(
		issueRows.map((issue) => [issue.id, issue.reporterId]),
	);
	for (const row of commentRows) {
		if (!row.created) continue;
		push(row.issueId, {
			issueId: row.issueId,
			at: row.created.getTime(),
			rank: 2,
			sequence: 0,
			event: {
				kind: "comment",
				at: row.created,
				author:
					row.authorId !== null && row.authorId === reporters.get(row.issueId)
						? "customer"
						: "agent",
				internal: row.internal,
			},
		});
	}

	for (const list of byIssue.values()) {
		list.sort(
			(left, right) =>
				left.at - right.at ||
				left.rank - right.rank ||
				left.sequence - right.sequence,
		);
	}
	return byIssue;
}

async function goalMatches(
	goals: (typeof slaGoals.$inferSelect)[],
	issueIds: string[],
): Promise<Map<string, Set<string>>> {
	const catalog = await loadCatalog();
	const matches = new Map<string, Set<string>>();
	for (const goal of goals) {
		if (goal.jql.trim() === "") {
			matches.set(goal.id, new Set(issueIds));
			continue;
		}
		const compiled = await compileJql(parseJql(goal.jql), {
			user: null,
			catalog,
			visibleProjectIds: ALL_PROJECTS,
		});
		if (!compiled.where) {
			matches.set(goal.id, new Set(issueIds));
			continue;
		}
		const result = await db.execute(
			sql`select issues.id from issues where ${compiled.where}`,
		);
		matches.set(
			goal.id,
			new Set((result.rows as { id: string }[]).map((row) => String(row.id))),
		);
	}
	return matches;
}

export async function rebuildSlaCycles(
	options: RebuildOptions = {},
): Promise<RebuildResult> {
	const now = options.now ?? new Date();
	if (options.issueIds && options.issueIds.length === 0) {
		return { issues: 0, cycles: 0 };
	}
	const desks = await db
		.select({ id: serviceDesks.id, projectId: serviceDesks.projectId })
		.from(serviceDesks);
	if (desks.length === 0) return { issues: 0, cycles: 0 };

	const projectIds = desks.map((desk) => desk.projectId);
	const issueRows = await db
		.select({
			id: issues.id,
			projectId: issues.projectId,
			created: issues.created,
			reporterId: issues.reporterId,
		})
		.from(issues)
		.where(
			options.issueIds
				? and(
						inArray(issues.projectId, projectIds),
						inArray(issues.id, options.issueIds),
					)
				: inArray(issues.projectId, projectIds),
		);
	if (issueRows.length === 0) return { issues: 0, cycles: 0 };
	const issueIds = issueRows.map((issue) => issue.id);

	const [calendarRows, metricRows, goalRows, commentRows, historyRows] =
		await Promise.all([
			db.select().from(slaCalendars),
			db.select().from(slaMetrics),
			db.select().from(slaGoals).orderBy(slaGoals.metricId, slaGoals.sequence),
			db
				.select({
					issueId: comments.issueId,
					authorId: comments.authorId,
					internal: comments.internal,
					created: comments.created,
				})
				.from(comments)
				.where(inArray(comments.issueId, issueIds)),
			db
				.select({
					issueId: issueHistory.issueId,
					created: issueHistory.created,
					sequence: issueHistoryItems.sequence,
					field: issueHistoryItems.field,
					toValue: issueHistoryItems.toValue,
				})
				.from(issueHistoryItems)
				.innerJoin(
					issueHistory,
					eq(issueHistoryItems.historyId, issueHistory.id),
				)
				.where(
					and(
						inArray(issueHistory.issueId, issueIds),
						inArray(issueHistoryItems.field, [
							"status",
							"assignee",
							"resolution",
						]),
					),
				),
		]);

	const calendars = new Map<string, SlaCalendar>(
		calendarRows.map((calendar) => [
			calendar.id,
			{
				timezone: calendar.timezone,
				workingHours: calendar.workingHours,
				holidays: calendar.holidays,
			},
		]),
	);
	const matches = await goalMatches(goalRows, issueIds);
	const events = eventRows(issueRows, commentRows, historyRows);
	const goalsByMetric = new Map<string, typeof goalRows>();
	for (const goal of goalRows) {
		const list = goalsByMetric.get(goal.metricId) ?? [];
		list.push(goal);
		goalsByMetric.set(goal.metricId, list);
	}

	const projectByDesk = new Map(desks.map((desk) => [desk.id, desk.projectId]));
	const metricsByProject = new Map<string, typeof metricRows>();
	for (const metric of metricRows) {
		const projectId = projectByDesk.get(metric.deskId);
		if (!projectId) continue;
		const list = metricsByProject.get(projectId) ?? [];
		list.push(metric);
		metricsByProject.set(projectId, list);
	}

	const rows: (typeof slaCycles.$inferInsert)[] = [];
	for (const issue of issueRows) {
		const issueEvents = (events.get(issue.id) ?? []).map((row) => row.event);
		for (const metric of metricsByProject.get(issue.projectId) ?? []) {
			const goal = (goalsByMetric.get(metric.id) ?? []).find((candidate) =>
				matches.get(candidate.id)?.has(issue.id),
			);
			if (!goal) continue;
			const calendar = calendars.get(goal.calendarId);
			if (!calendar) {
				throw new Error(
					`SLA goal ${goal.id} references calendar ${goal.calendarId}, which is not imported`,
				);
			}
			const cycles: SlaCycle[] = computeSlaCycles({
				metric: {
					start: metric.startConditions,
					pause: metric.pauseConditions,
					stop: metric.stopConditions,
				},
				goal: { minutes: goal.goalMinutes, calendar },
				events: issueEvents,
				now,
			});
			for (const cycle of cycles) {
				rows.push({
					issueId: issue.id,
					metricId: metric.id,
					cycleNumber: cycle.cycle,
					startedAt: cycle.startedAt,
					stoppedAt: cycle.stoppedAt,
					pausedIntervals: cycle.pausedIntervals.map((pause) => ({
						from: pause.from.toISOString(),
						to: pause.to.toISOString(),
					})),
					goalMinutes: cycle.goalMinutes,
					elapsedMinutes: cycle.elapsedMinutes,
					breached: cycle.breached,
					breachTime: cycle.breachTime,
					computedAt: now,
				});
			}
		}
	}

	await db.transaction(async (tx) => {
		await tx.delete(slaCycles).where(inArray(slaCycles.issueId, issueIds));
		for (let index = 0; index < rows.length; index += 500) {
			await tx.insert(slaCycles).values(rows.slice(index, index + 500));
		}
	});

	return { issues: issueRows.length, cycles: rows.length };
}
