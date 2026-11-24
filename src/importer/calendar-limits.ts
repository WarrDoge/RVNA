import type { JiraDataset, JiraWorkingCalendar } from "./types.ts";

const DAY_MS = 86_400_000;
/** A working interval may run past midnight into the next days, never past a week. */
const MAX_WORKING_TIME_MS = 7 * DAY_MS;
const MAX_WORKING_TIMES = 1000;
const MAX_HOLIDAY_SPAN_DAYS = 366;
const MAX_HOLIDAY_DAYS = 20_000;

/**
 * Why a calendar from the source server is out of bounds, or null. The importer
 * loops once per day of a working interval and per day of a holiday, so
 * numbers it takes from the server must be small before they reach those loops.
 */
export function calendarProblem(calendar: JiraWorkingCalendar): string | null {
	const times = calendar.workingTimes ?? [];
	if (times.length > MAX_WORKING_TIMES) {
		return `it has more than ${MAX_WORKING_TIMES} working times`;
	}
	for (const time of times) {
		if (time.disabled) continue;
		for (const value of [time.start, time.end]) {
			if (
				typeof value !== "number" ||
				!Number.isFinite(value) ||
				value < 0 ||
				value > MAX_WORKING_TIME_MS
			) {
				return `a working time on ${time.weekday} reaches outside 0 to ${MAX_WORKING_TIME_MS / DAY_MS} days`;
			}
		}
	}
	let days = 0;
	for (const holiday of calendar.holidays ?? []) {
		if (!holiday.startDate) {
			days++;
			continue;
		}
		const start = Date.parse(`${holiday.startDate}T00:00:00Z`);
		const end = Date.parse(`${holiday.endDate ?? holiday.startDate}T00:00:00Z`);
		const span = (end - start) / DAY_MS;
		// An unparseable date is left to the holiday mapper, which names it.
		if (Number.isNaN(span)) continue;
		if (span >= MAX_HOLIDAY_SPAN_DAYS) {
			return `a holiday spans more than ${MAX_HOLIDAY_SPAN_DAYS} days`;
		}
		days += Math.max(0, span) + 1;
	}
	if (days > MAX_HOLIDAY_DAYS) {
		return `its holidays cover more than ${MAX_HOLIDAY_DAYS} days`;
	}
	return null;
}

/**
 * The dataset without the calendars that are out of bounds and without the SLA
 * goals that use them, so one bad calendar does not stop the import. Each one
 * is named in a warning.
 */
export function withoutBadCalendars(dataset: JiraDataset): JiraDataset {
	const bad = new Set<string>();
	for (const calendar of dataset.slaCalendars ?? []) {
		const problem = calendarProblem(calendar);
		if (problem) {
			bad.add(String(calendar.id));
			console.warn(
				`SLA calendar ${calendar.id} was not imported: ${problem}; the SLA goals that use it are skipped`,
			);
		}
	}
	if (bad.size === 0) return dataset;
	return {
		...dataset,
		slaCalendars: dataset.slaCalendars?.filter(
			(calendar) => !bad.has(String(calendar.id)),
		),
		serviceDesks: dataset.serviceDesks?.map((desk) => ({
			...desk,
			metrics: desk.metrics.map((metric) => ({
				...metric,
				config: metric.config && {
					...metric.config,
					goals: metric.config.goals?.filter(
						(goal) => !bad.has(String(goal.calendarId)),
					),
				},
			})),
		})),
	};
}
