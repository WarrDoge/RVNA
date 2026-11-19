import { afterEach, expect, test } from "vitest";
import {
	absoluteDate,
	endOfDay,
	formatDateOnly,
	relativeDate,
	setDateProvider,
	shortDate,
	startOfDay,
} from "../src/lib/dates.ts";

const instant = "2026-01-15T22:30:00.000Z";
const now = Date.parse(instant);

function use(timeZone: string, locale: string, fixedNow = now) {
	setDateProvider(() => ({ timeZone, locale, now: fixedNow }));
}

afterEach(() => setDateProvider(null));

test("the same instant follows three zones and two locales", () => {
	const expected = new Map([
		["Europe/Helsinki|en-GB", "16 Jan 2026, 00:30"],
		["Europe/Helsinki|de-DE", "16.01.2026, 00:30"],
		["Pacific/Auckland|en-GB", "16 Jan 2026, 11:30"],
		["Pacific/Auckland|de-DE", "16.01.2026, 11:30"],
		["UTC|en-GB", "15 Jan 2026, 22:30"],
		["UTC|de-DE", "15.01.2026, 22:30"],
	]);

	for (const [key, text] of expected) {
		const [timeZone, locale] = key.split("|");
		use(timeZone as string, locale as string);
		expect(absoluteDate(instant)).toBe(text);
	}
});

test("shortDate crosses midnight in the user's zone, not the process zone", () => {
	use("Europe/Helsinki", "en-GB");
	expect(shortDate(instant)).toBe("16/Jan/26");
	use("Pacific/Auckland", "en-GB");
	expect(shortDate(instant)).toBe("16/Jan/26");
	use("UTC", "en-GB");
	expect(shortDate(instant)).toBe("15/Jan/26");
});

test("formatDateOnly keeps the calendar date it was given", () => {
	use("Pacific/Auckland", "de-DE");
	expect(formatDateOnly("2026-01-15")).toBe("15. Jan. 2026");
	use("UTC", "en-GB");
	expect(formatDateOnly("2026-01-15")).toBe("15 Jan 2026");
});

test("day boundaries are the user's midnight, not the process midnight", () => {
	use("Pacific/Auckland", "en-GB");
	expect(startOfDay("2026-01-15")).toBe("2026-01-14T11:00:00.000Z");
	expect(endOfDay("2026-01-15")).toBe("2026-01-15T10:59:59.999Z");
	use("Europe/Helsinki", "en-GB");
	expect(startOfDay("2026-01-15")).toBe("2026-01-14T22:00:00.000Z");
});

test("relative text uses the fixed now and the user's zone", () => {
	use("Pacific/Auckland", "en-GB");
	expect(relativeDate("2026-01-15T22:29:30.000Z")).toBe("just now");
	expect(relativeDate("2026-01-15T22:25:00.000Z")).toBe("5 minutes ago");
	expect(relativeDate("2026-01-15T20:30:00.000Z")).toBe("2 hours ago");
	expect(relativeDate("2026-01-13T22:30:00.000Z")).toBe("2 days ago 11:30");
	expect(relativeDate("2026-01-15T22:30:30.000Z")).toBe("in a moment");
});
