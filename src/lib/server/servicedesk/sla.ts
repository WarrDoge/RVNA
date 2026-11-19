import { and, asc, eq, inArray } from "drizzle-orm";
import {
	type SlaCalendar,
	workingMinutesBetween,
} from "../../shared/sla/index.ts";
import { db } from "../db.ts";
import {
	issues,
	serviceDesks,
	slaCalendars,
	slaCycles,
	slaGoals,
	slaMetrics,
} from "../schema.ts";

export type SlaState = "ongoing" | "paused" | "completed" | "breached";

export interface CycleDisplay {
	cycle: number;
	state: SlaState;
	startedAt: string;
	stoppedAt: string | null;
	goalMinutes: number | null;
	elapsedMinutes: number;
	remainingMinutes: number | null;
	breached: boolean;
	breachTime: string | null;
}

export interface MetricDisplay {
	id: string;
	name: string;
	customerVisible: boolean;
	goalMinutes: number | null;
	calendar: { name: string; timezone: string } | null;
	cycles: CycleDisplay[];
}

export interface StoredCycle {
	cycleNumber: number;
	startedAt: Date;
	stoppedAt: Date | null;
	pausedIntervals: { from: string; to: string }[];
	goalMinutes: number | null;
	elapsedMinutes: number;
	breached: boolean;
	breachTime: Date | null;
	computedAt: Date;
}

const PAUSE_TOLERANCE_MS = 1000;

/** The pause that was still running when the cycle was last computed. */
function pausedSince(cycle: StoredCycle): number | null {
	if (cycle.stoppedAt) return null;
	const last = cycle.pausedIntervals[cycle.pausedIntervals.length - 1];
	if (!last) return null;
	const to = Date.parse(last.to);
	if (Number.isNaN(to)) return null;
	if (Math.abs(to - cycle.computedAt.getTime()) > PAUSE_TOLERANCE_MS) {
		return null;
	}
	const from = Date.parse(last.from);
	return Number.isNaN(from) ? null : from;
}

function pausedMinutes(
	calendar: SlaCalendar,
	startedAt: number,
	pauses: { from: number; to: number }[],
	end: number,
): number {
	let total = 0;
	for (const pause of pauses) {
		const from = Math.max(pause.from, startedAt);
		const to = Math.min(pause.to, end);
		if (to > from) {
			total += workingMinutesBetween(calendar, new Date(from), new Date(to));
		}
	}
	return total;
}

/**
 * Remaining and elapsed time at `now`, from the stored cycle and its calendar.
 * An open cycle counts working time up to the moment it is read; a cycle that
 * was paused when it was stored keeps counting up to the pause.
 */
export function displayCycle(
	cycle: StoredCycle,
	calendar: SlaCalendar | null,
	now: Date,
): CycleDisplay {
	const goal = cycle.goalMinutes;
	let elapsed = cycle.elapsedMinutes;
	let remaining = goal === null ? null : goal - elapsed;
	const pausedAt = pausedSince(cycle);

	if (!cycle.stoppedAt && calendar) {
		const pauses = cycle.pausedIntervals
			.map((pause) => ({
				from: Date.parse(pause.from),
				to: Date.parse(pause.to),
			}))
			.filter((pause) => !Number.isNaN(pause.from) && !Number.isNaN(pause.to));
		const end = pausedAt ?? now.getTime();
		elapsed =
			workingMinutesBetween(calendar, cycle.startedAt, new Date(end)) -
			pausedMinutes(calendar, cycle.startedAt.getTime(), pauses, end);
		elapsed = Math.max(0, Math.round(elapsed));
		remaining = goal === null ? null : Math.round(goal - elapsed);
	}

	const overGoal = goal !== null && (remaining === null || remaining < 0);
	let state: SlaState;
	if (cycle.stoppedAt) {
		state = overGoal || cycle.breached ? "breached" : "completed";
	} else if (overGoal || cycle.breached) {
		state = "breached";
	} else if (pausedAt !== null) {
		state = "paused";
	} else {
		state = "ongoing";
	}

	return {
		cycle: cycle.cycleNumber,
		state,
		startedAt: cycle.startedAt.toISOString(),
		stoppedAt: cycle.stoppedAt?.toISOString() ?? null,
		goalMinutes: goal,
		elapsedMinutes: elapsed,
		remainingMinutes: remaining,
		breached: state === "breached",
		breachTime: cycle.breachTime?.toISOString() ?? null,
	};
}

function calendarOf(row: typeof slaCalendars.$inferSelect): SlaCalendar {
	return {
		timezone: row.timezone,
		workingHours: row.workingHours,
		holidays: row.holidays,
	};
}

/**
 * The goal a cycle was measured against. A cycle stores its goal duration but
 * not the goal row, so the goal is matched by that duration; the metric's first
 * goal stands in when two goals share one.
 */
function goalForCycle(
	goals: (typeof slaGoals.$inferSelect)[],
	goalMinutes: number | null,
) {
	return goals.find((goal) => goal.goalMinutes === goalMinutes) ?? goals[0];
}

export async function issueSla(
	issueId: string,
	now: Date = new Date(),
): Promise<MetricDisplay[]> {
	const [issue] = await db
		.select({ projectId: issues.projectId })
		.from(issues)
		.where(eq(issues.id, issueId))
		.limit(1);
	if (!issue) return [];

	const [desk] = await db
		.select({ id: serviceDesks.id })
		.from(serviceDesks)
		.where(eq(serviceDesks.projectId, issue.projectId))
		.limit(1);
	if (!desk) return [];

	const metricRows = await db
		.select({
			id: slaMetrics.id,
			name: slaMetrics.name,
			customerVisible: slaMetrics.customerVisible,
		})
		.from(slaMetrics)
		.where(eq(slaMetrics.deskId, desk.id))
		.orderBy(asc(slaMetrics.name));
	if (metricRows.length === 0) return [];

	const metricIds = metricRows.map((metric) => metric.id);
	const [cycleRows, goalRows] = await Promise.all([
		db
			.select()
			.from(slaCycles)
			.where(
				and(
					eq(slaCycles.issueId, issueId),
					inArray(slaCycles.metricId, metricIds),
				),
			)
			.orderBy(asc(slaCycles.cycleNumber)),
		db
			.select()
			.from(slaGoals)
			.where(inArray(slaGoals.metricId, metricIds))
			.orderBy(asc(slaGoals.metricId), asc(slaGoals.sequence)),
	]);

	const calendarIds = [...new Set(goalRows.map((goal) => goal.calendarId))];
	const calendarRows =
		calendarIds.length === 0
			? []
			: await db
					.select()
					.from(slaCalendars)
					.where(inArray(slaCalendars.id, calendarIds));
	const calendars = new Map(calendarRows.map((row) => [row.id, row]));

	return metricRows
		.map((metric) => {
			const goals = goalRows.filter((goal) => goal.metricId === metric.id);
			const cycles = cycleRows
				.filter((cycle) => cycle.metricId === metric.id)
				.map((cycle) => {
					const goal = goalForCycle(goals, cycle.goalMinutes);
					const calendarRow = goal ? calendars.get(goal.calendarId) : undefined;
					return displayCycle(
						cycle,
						calendarRow ? calendarOf(calendarRow) : null,
						now,
					);
				});
			const active = cycles.find(
				(cycle) => cycle.state === "ongoing" || cycle.state === "paused",
			);
			const latest = active ?? cycles[cycles.length - 1];
			const goal = goalForCycle(goals, latest?.goalMinutes ?? null);
			const calendarRow = goal ? calendars.get(goal.calendarId) : undefined;
			return {
				id: metric.id,
				name: metric.name,
				customerVisible: metric.customerVisible,
				goalMinutes: latest?.goalMinutes ?? null,
				calendar: calendarRow
					? { name: calendarRow.name, timezone: calendarRow.timezone }
					: null,
				cycles,
			};
		})
		.filter((metric) => metric.cycles.length > 0);
}
