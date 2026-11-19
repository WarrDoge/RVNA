import { describe, expect, test } from "vitest";
import {
	addWorkingMinutes,
	alwaysOpenCalendar,
	type SlaCalendar,
	workingMinutesBetween,
} from "../src/lib/shared/sla/index.ts";

const workday = [{ start: 9 * 60, end: 17 * 60 }];

function businessHours(
	timezone = "Etc/UTC",
	holidays: string[] = [],
): SlaCalendar {
	return {
		timezone,
		workingHours: [workday, workday, workday, workday, workday, [], []],
		holidays,
	};
}

function at(iso: string) {
	return new Date(iso);
}

const calendar = businessHours();

describe("working minutes between two instants", () => {
	test.each([
		["zero length", "2026-01-05T09:00:00Z", "2026-01-05T09:00:00Z", 0],
		["reversed range", "2026-01-05T17:00:00Z", "2026-01-05T09:00:00Z", -480],
		["weekend", "2026-01-03T10:00:00Z", "2026-01-03T12:00:00Z", 0],
		[
			"start before working hours",
			"2026-01-05T07:00:00Z",
			"2026-01-05T10:00:00Z",
			60,
		],
		[
			"end after working hours",
			"2026-01-05T16:00:00Z",
			"2026-01-05T19:00:00Z",
			60,
		],
		["weekend span", "2026-01-02T16:00:00Z", "2026-01-05T10:00:00Z", 120],
		["several days", "2026-01-05T09:00:00Z", "2026-01-07T17:00:00Z", 3 * 480],
		["seconds are kept", "2026-01-05T09:00:30Z", "2026-01-05T09:01:30Z", 1],
		["sub-minute range", "2026-01-05T09:00:00Z", "2026-01-05T09:00:30Z", 0.5],
	])("returns %s", (_name, from, to, expected) => {
		expect(workingMinutesBetween(calendar, at(from), at(to))).toBe(expected);
	});

	test("skips a holiday", () => {
		const withHoliday = businessHours("Etc/UTC", ["2026-01-05"]);
		expect(
			workingMinutesBetween(
				withHoliday,
				at("2026-01-05T09:00:00Z"),
				at("2026-01-05T17:00:00Z"),
			),
		).toBe(0);
		expect(
			workingMinutesBetween(
				withHoliday,
				at("2026-01-06T09:00:00Z"),
				at("2026-01-06T10:00:00Z"),
			),
		).toBe(60);
	});

	test("counts every minute on a 24x7 calendar", () => {
		const open = alwaysOpenCalendar();
		expect(
			workingMinutesBetween(
				open,
				at("2026-01-05T09:17:00Z"),
				at("2026-01-05T17:43:00Z"),
			),
		).toBe(506);
	});
});

describe("timezones", () => {
	const from = at("2026-06-01T08:00:00Z");
	const to = at("2026-06-01T16:00:00Z");

	test.each([
		["Etc/UTC", 420],
		["Europe/Helsinki", 360],
		["America/New_York", 180],
	])("uses the wall clock in %s", (timezone, expected) => {
		expect(workingMinutesBetween(businessHours(timezone), from, to)).toBe(
			expected,
		);
	});
});

describe("daylight saving in Europe/Helsinki", () => {
	test("spring forward has a 23 hour day", () => {
		const open = alwaysOpenCalendar("Europe/Helsinki");
		expect(
			workingMinutesBetween(
				open,
				at("2026-03-29T00:00:00+02:00"),
				at("2026-03-30T00:00:00+03:00"),
			),
		).toBe(23 * 60);
	});

	test("fall back has a 25 hour day", () => {
		const open = alwaysOpenCalendar("Europe/Helsinki");
		expect(
			workingMinutesBetween(
				open,
				at("2026-10-25T00:00:00+03:00"),
				at("2026-10-26T00:00:00+02:00"),
			),
		).toBe(25 * 60);
	});

	test("adding minutes across the spring gap lands on the wall clock", () => {
		const open = alwaysOpenCalendar("Europe/Helsinki");
		expect(
			addWorkingMinutes(
				open,
				at("2026-03-29T00:00:00+02:00"),
				180,
			).toISOString(),
		).toBe("2026-03-29T01:00:00.000Z");
	});

	test("adding minutes across the fall overlap stays on the wall clock", () => {
		const open = alwaysOpenCalendar("Europe/Helsinki");
		expect(
			addWorkingMinutes(
				open,
				at("2026-10-25T00:00:00+03:00"),
				240,
			).toISOString(),
		).toBe("2026-10-25T01:00:00.000Z");
	});

	test("adding a day across spring forward is 24 real hours", () => {
		const open = alwaysOpenCalendar("Europe/Helsinki");
		expect(
			addWorkingMinutes(
				open,
				at("2026-03-28T12:00:00Z"),
				24 * 60,
			).toISOString(),
		).toBe("2026-03-29T12:00:00.000Z");
	});
});

describe("adding working minutes", () => {
	test("zero minutes returns the same instant", () => {
		const from = at("2026-01-05T07:30:00Z");
		expect(addWorkingMinutes(calendar, from, 0).toISOString()).toBe(
			from.toISOString(),
		);
	});

	test("starts counting at the next working interval", () => {
		expect(
			addWorkingMinutes(calendar, at("2026-01-05T07:00:00Z"), 60).toISOString(),
		).toBe("2026-01-05T10:00:00.000Z");
	});

	test("skips the weekend", () => {
		expect(
			addWorkingMinutes(
				calendar,
				at("2026-01-02T16:00:00Z"),
				120,
			).toISOString(),
		).toBe("2026-01-05T10:00:00.000Z");
	});

	test("skips a holiday", () => {
		const withHoliday = businessHours("Etc/UTC", ["2026-01-05"]);
		expect(
			addWorkingMinutes(
				withHoliday,
				at("2026-01-02T16:00:00Z"),
				120,
			).toISOString(),
		).toBe("2026-01-06T10:00:00.000Z");
	});

	test("lands on the interval end exactly", () => {
		expect(
			addWorkingMinutes(
				calendar,
				at("2026-01-05T09:00:00Z"),
				480,
			).toISOString(),
		).toBe("2026-01-05T17:00:00.000Z");
	});

	test("rejects negative minutes", () => {
		expect(() =>
			addWorkingMinutes(calendar, at("2026-01-05T09:00:00Z"), -1),
		).toThrow("non-negative");
	});

	test("rejects a calendar without working time", () => {
		const empty: SlaCalendar = {
			timezone: "Etc/UTC",
			workingHours: [[], [], [], [], [], [], []],
			holidays: [],
		};
		expect(() =>
			addWorkingMinutes(empty, at("2026-01-05T09:00:00Z"), 1),
		).toThrow("no working time");
	});
});
