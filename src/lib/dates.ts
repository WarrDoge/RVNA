export type DateContext = {
	timeZone: string;
	locale: string;
	now: number;
};

type DateProvider = () => DateContext;

const processDefaults = Intl.DateTimeFormat().resolvedOptions();

let provider: DateProvider | null = null;
let browserDefaults: { timeZone: string; locale: string } | null = null;
let clientNow: number | null = null;

/** The browser and the server hook each install their own provider. */
export function setDateProvider(next: DateProvider | null) {
	provider = next;
	formatters.clear();
}

/** The root layout's `now`, so the first client render matches the server's. */
export function setClientNow(value: number | null) {
	clientNow = value;
}

function context(): DateContext {
	if (provider) return provider();
	if (typeof window !== "undefined") {
		return { ...browserDateDefaults(), now: clientNow ?? Date.now() };
	}
	return {
		timeZone: processDefaults.timeZone,
		locale: processDefaults.locale,
		now: clientNow ?? Date.now(),
	};
}

/** The browser's own zone and language, resolved once. */
export function browserDateDefaults() {
	browserDefaults ??= {
		timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		locale: navigator.language,
	};
	return browserDefaults;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
	locale: string,
	timeZone: string,
	options: Intl.DateTimeFormatOptions,
) {
	const key = `${locale}\u0000${timeZone}\u0000${JSON.stringify(options)}`;
	let formatter = formatters.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
		formatters.set(key, formatter);
	}
	return formatter;
}

function instant(value: string | null | undefined) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function part(parts: Intl.DateTimeFormatPart[], type: string) {
	return parts.find((item) => item.type === type)?.value ?? "";
}

function plural(value: number, unit: string) {
	return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function absoluteDate(value: string | null | undefined) {
	const date = instant(value);
	if (!date) return "";
	const { locale, timeZone } = context();
	return formatterFor(locale, timeZone, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

/** `dd/MMM/yy`, the date format of Jira's issue tables. */
export function shortDate(value: string | null | undefined) {
	const date = instant(value);
	if (!date) return "";
	const { timeZone } = context();
	const parts = formatterFor("en-US", timeZone, {
		day: "2-digit",
		month: "short",
		year: "2-digit",
	}).formatToParts(date);
	return `${part(parts, "day")}/${part(parts, "month")}/${part(parts, "year")}`;
}

export function relativeDate(value: string | null | undefined) {
	const date = instant(value);
	if (!date) return "";

	const { locale, timeZone, now } = context();
	const diff = now - date.getTime();
	const future = diff < 0;
	const abs = Math.abs(diff);

	if (abs < 45_000) return future ? "in a moment" : "just now";

	const minutes = Math.round(abs / 60_000);
	if (minutes < 60) {
		return future
			? `in ${plural(minutes, "minute")}`
			: `${plural(minutes, "minute")} ago`;
	}

	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return future
			? `in ${plural(hours, "hour")}`
			: `${plural(hours, "hour")} ago`;
	}

	const days = Math.round(hours / 24);
	if (days < 30) {
		const relative = future
			? `in ${plural(days, "day")}`
			: `${plural(days, "day")} ago`;
		const time = formatterFor(locale, timeZone, {
			hour: "numeric",
			minute: "2-digit",
		}).format(date);
		return `${relative} ${time}`;
	}

	return absoluteDate(value);
}

export function formatDateOnly(value: string | null | undefined) {
	if (!value) return "";
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (match) {
		const year = Number(match[1]);
		const month = Number(match[2]);
		const day = Number(match[3]);
		const date = new Date(Date.UTC(year, month - 1, day));
		if (
			date.getUTCFullYear() !== year ||
			date.getUTCMonth() !== month - 1 ||
			date.getUTCDate() !== day
		) {
			return value;
		}
		const { locale } = context();
		return formatterFor(locale, "UTC", {
			year: "numeric",
			month: "short",
			day: "numeric",
		}).format(date);
	}
	const date = instant(value);
	if (!date) return value;
	const { locale, timeZone } = context();
	return formatterFor(locale, timeZone, {
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(date);
}

function offsetAt(instant: number, timeZone: string) {
	const parts = formatterFor("en-US", timeZone, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(instant));
	const number = (type: string) => Number(part(parts, type));
	const wall = Date.UTC(
		number("year"),
		number("month") - 1,
		number("day"),
		number("hour"),
		number("minute"),
		number("second"),
	);
	return wall - instant;
}

function zonedMidnight(
	year: number,
	month: number,
	day: number,
	timeZone: string,
) {
	const wall = Date.UTC(year, month - 1, day);
	const first = wall - offsetAt(wall, timeZone);
	return wall - offsetAt(first, timeZone);
}

function dateParts(value: string | null | undefined) {
	if (!value) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return { year, month, day };
}

/** The first instant of a date-only value in the user's zone. */
export function startOfDay(
	value: string | null | undefined,
	timeZone = context().timeZone,
) {
	const parts = dateParts(value);
	if (!parts) return "";
	return new Date(
		zonedMidnight(parts.year, parts.month, parts.day, timeZone),
	).toISOString();
}

/** The last instant of a date-only value in the user's zone. */
export function endOfDay(
	value: string | null | undefined,
	timeZone = context().timeZone,
) {
	const parts = dateParts(value);
	if (!parts) return "";
	const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
	return new Date(
		zonedMidnight(
			next.getUTCFullYear(),
			next.getUTCMonth() + 1,
			next.getUTCDate(),
			timeZone,
		) - 1,
	).toISOString();
}

/** A timestamp as a calendar date in the user's zone. */
export function calendarDate(value: string | null | undefined) {
	const date = instant(value);
	if (!date) return "";
	const { locale, timeZone } = context();
	return formatterFor(locale, timeZone, {
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(date);
}

/** A timestamp as a calendar date and time in the user's zone. */
export function calendarDateTime(value: string | null | undefined) {
	const date = instant(value);
	if (!date) return "";
	const { locale, timeZone } = context();
	return formatterFor(locale, timeZone, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

/** The short month and day, for chart axes. */
export function monthDay(value: string | null | undefined) {
	const date = instant(value);
	if (!date) return "";
	const { locale, timeZone } = context();
	return formatterFor(locale, timeZone, {
		month: "short",
		day: "numeric",
	}).format(date);
}

/** The short month, day and time, for chart tooltips. */
export function monthDayTime(value: string | null | undefined) {
	const date = instant(value);
	if (!date) return "";
	const { locale, timeZone } = context();
	return formatterFor(locale, timeZone, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

/** The two-digit day, short month, two-digit year and time, for sprint ranges. */
export function shortDateTime(value: string | null | undefined) {
	const date = instant(value);
	if (!date) return "";
	const { locale, timeZone } = context();
	return formatterFor(locale, timeZone, {
		day: "2-digit",
		month: "short",
		year: "2-digit",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

/** The wiki list's relative text, which falls back to a calendar date. */
export function relativeShortDate(value: string | null | undefined) {
	const date = instant(value);
	if (!date) return "";
	const { now } = context();
	const minutes = Math.round((now - date.getTime()) / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} minutes ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} hours ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days} days ago`;
	return calendarDate(value);
}

/**
 * A wiki date macro is a date, not an instant: keep its UTC calendar day and
 * the English month of the stored Confluence markup.
 */
export function formatWikiDate(datetime: unknown): string {
	if (typeof datetime !== "string" || datetime === "") return "";
	const time = /^\d+$/.test(datetime) ? Number(datetime) : Date.parse(datetime);
	if (Number.isNaN(time)) return datetime;
	return formatterFor("en-US", "UTC", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(time));
}

export function formatDuration(seconds: number | null | undefined) {
	if (seconds === null || seconds === undefined) return "0m";
	const total = Math.max(0, Math.round(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const remainder = total % 60;
	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (remainder > 0 || parts.length === 0) parts.push(`${remainder}s`);
	return parts.join(" ");
}

export function parseDuration(value: string) {
	const trimmed = value.trim().toLowerCase();
	if (trimmed === "") return null;
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 60;

	let total = 0;
	let matched = false;
	const pattern = /(\d+(?:\.\d+)?)\s*([wdhms])/g;
	for (const match of trimmed.matchAll(pattern)) {
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
						: unit === "s"
							? amount
							: amount * 60;
	}
	return matched ? Math.round(total) : null;
}

export function formatBytes(size: number) {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
