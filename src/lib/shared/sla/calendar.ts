import type { SlaCalendar, WorkingInterval } from "./types.ts";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

interface LocalDate {
	year: number;
	month: number;
	day: number;
}

interface LocalParts extends LocalDate {
	hour: number;
	minute: number;
	second: number;
	millisecond: number;
}

export interface InstantInterval {
	start: number;
	end: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
	let formatter = formatters.get(timezone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			fractionalSecondDigits: 3,
		});
		formatters.set(timezone, formatter);
	}
	return formatter;
}

function localParts(instant: Date, timezone: string): LocalParts {
	const values: Record<string, number> = {};
	for (const part of formatterFor(timezone).formatToParts(instant)) {
		if (part.type !== "literal") values[part.type] = Number(part.value);
	}
	return {
		year: values.year,
		month: values.month,
		day: values.day,
		hour: values.hour,
		minute: values.minute,
		second: values.second,
		millisecond: values.fractionalSecond ?? 0,
	};
}

function wallTime(parts: LocalParts): number {
	return Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
		parts.millisecond,
	);
}

function offsetAt(instant: number, timezone: string): number {
	return wallTime(localParts(new Date(instant), timezone)) - instant;
}

/**
 * The instant whose wall clock in `timezone` reads `wall` (milliseconds since the
 * epoch interpreted as a UTC wall clock). Ambiguous times resolve to the first
 * occurrence; times skipped by a spring-forward resolve to the shifted instant.
 */
function instantFromWall(timezone: string, wall: number): number {
	const firstOffset = offsetAt(wall, timezone);
	let instant = wall - firstOffset;
	const secondOffset = offsetAt(instant, timezone);
	if (secondOffset !== firstOffset) instant = wall - secondOffset;
	return instant;
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number): string {
	return `${year}-${pad(month)}-${pad(day)}`;
}

function weekdayIndex(year: number, month: number, day: number): number {
	return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function localDate(instant: Date, timezone: string): LocalDate {
	const parts = localParts(instant, timezone);
	return { year: parts.year, month: parts.month, day: parts.day };
}

function dayIntervals(
	calendar: SlaCalendar,
	year: number,
	month: number,
	day: number,
): InstantInterval[] {
	if (calendar.holidays.includes(dateKey(year, month, day))) return [];
	const hours = calendar.workingHours[weekdayIndex(year, month, day)] ?? [];
	const dayStart = Date.UTC(year, month - 1, day);
	return hours
		.filter((interval) => interval.end > interval.start)
		.map((interval) => ({
			start: instantFromWall(
				calendar.timezone,
				dayStart + interval.start * MINUTE_MS,
			),
			end: instantFromWall(
				calendar.timezone,
				dayStart + interval.end * MINUTE_MS,
			),
		}))
		.sort((left, right) => left.start - right.start);
}

function merge(intervals: InstantInterval[]): InstantInterval[] {
	const sorted = [...intervals].sort((left, right) => left.start - right.start);
	const merged: InstantInterval[] = [];
	for (const interval of sorted) {
		const last = merged[merged.length - 1];
		if (last && interval.start <= last.end) {
			last.end = Math.max(last.end, interval.end);
		} else {
			merged.push({ ...interval });
		}
	}
	return merged;
}

/** Working intervals between two instants, clipped to the range and merged. */
export function workingIntervalsBetween(
	calendar: SlaCalendar,
	from: Date,
	to: Date,
): InstantInterval[] {
	const fromMs = from.getTime();
	const toMs = to.getTime();
	if (!(fromMs < toMs)) return [];

	const start = localDate(from, calendar.timezone);
	const end = localDate(to, calendar.timezone);
	const last = Date.UTC(end.year, end.month - 1, end.day);
	const intervals: InstantInterval[] = [];

	for (
		let cursor = Date.UTC(start.year, start.month - 1, start.day), guard = 0;
		cursor <= last && guard < 366 * 200;
		cursor += DAY_MS, guard++
	) {
		const day = new Date(cursor);
		for (const interval of dayIntervals(
			calendar,
			day.getUTCFullYear(),
			day.getUTCMonth() + 1,
			day.getUTCDate(),
		)) {
			const startMs = Math.max(interval.start, fromMs);
			const endMs = Math.min(interval.end, toMs);
			if (endMs > startMs) intervals.push({ start: startMs, end: endMs });
		}
	}

	return merge(intervals);
}

/** Working milliseconds between two instants; negative when `to` is before `from`. */
export function workingMillisecondsBetween(
	calendar: SlaCalendar,
	from: Date,
	to: Date,
): number {
	if (to.getTime() === from.getTime()) return 0;
	if (to.getTime() < from.getTime()) {
		const value = -workingMillisecondsBetween(calendar, to, from);
		return value === 0 ? 0 : value;
	}
	return workingIntervalsBetween(calendar, from, to).reduce(
		(total, interval) => total + (interval.end - interval.start),
		0,
	);
}

/** Working minutes between two instants; negative when `to` is before `from`. */
export function workingMinutesBetween(
	calendar: SlaCalendar,
	from: Date,
	to: Date,
): number {
	return workingMillisecondsBetween(calendar, from, to) / MINUTE_MS;
}

/** The instant reached after adding working minutes to `from`. */
export function addWorkingMinutes(
	calendar: SlaCalendar,
	from: Date,
	minutes: number,
): Date {
	if (!Number.isFinite(minutes) || minutes < 0) {
		throw new Error("working minutes must be a non-negative number");
	}
	const fromMs = from.getTime();
	let remaining = minutes * MINUTE_MS;
	if (remaining === 0) return new Date(fromMs);

	const start = localDate(from, calendar.timezone);
	for (
		let cursor = Date.UTC(start.year, start.month - 1, start.day), guard = 0;
		guard < 366 * 200;
		cursor += DAY_MS, guard++
	) {
		const day = new Date(cursor);
		for (const interval of dayIntervals(
			calendar,
			day.getUTCFullYear(),
			day.getUTCMonth() + 1,
			day.getUTCDate(),
		)) {
			const startMs = Math.max(interval.start, fromMs);
			if (interval.end <= startMs) continue;
			const length = interval.end - startMs;
			if (remaining <= length) return new Date(startMs + remaining);
			remaining -= length;
		}
	}

	throw new Error("calendar has no working time after the given instant");
}

/** A calendar that counts every minute of every day. */
export function alwaysOpenCalendar(timezone = "UTC"): SlaCalendar {
	const day: WorkingInterval[] = [{ start: 0, end: 1440 }];
	return {
		timezone,
		workingHours: [day, day, day, day, day, day, day],
		holidays: [],
	};
}
