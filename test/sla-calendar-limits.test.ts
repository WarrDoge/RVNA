import { describe, expect, test, vi } from "vitest";
import {
	calendarProblem,
	withoutBadCalendars,
} from "../src/importer/calendar-limits.ts";
import { mapWorkingHours } from "../src/importer/servicedesk-import.ts";
import type {
	JiraDataset,
	JiraWorkingCalendar,
} from "../src/importer/types.ts";
import { serviceDeskFixtureDataset } from "./fixtures/servicedesk.ts";

const HOUR = 3_600_000;

function calendar(
	overrides: Partial<JiraWorkingCalendar> = {},
): JiraWorkingCalendar {
	return {
		id: 1,
		name: "Office",
		timezoneId: "UTC",
		workingTimes: [{ weekday: "MONDAY", start: 9 * HOUR, end: 17 * HOUR }],
		holidays: [],
		...overrides,
	};
}

describe("calendar limits", () => {
	test("calendars of a normal size pass", () => {
		expect(calendarProblem(calendar())).toBeNull();
		expect(
			calendarProblem(
				calendar({
					workingTimes: [
						{ weekday: "FRIDAY", start: 22 * HOUR, end: 30 * HOUR },
					],
					holidays: [
						{ date: "2026-12-25" },
						{ startDate: "2026-12-24", endDate: "2027-01-02" },
					],
				}),
			),
		).toBeNull();
		for (const fixture of serviceDeskFixtureDataset().slaCalendars ?? []) {
			expect(calendarProblem(fixture)).toBeNull();
		}
	});

	test("a working time whose numbers would never finish the day loop is refused", () => {
		for (const value of [1e308, Number.POSITIVE_INFINITY, Number.NaN, -1]) {
			const bad = calendar({
				workingTimes: [{ weekday: "MONDAY", start: value, end: 2 * HOUR }],
			});
			expect(calendarProblem(bad)).toMatch(/working time on MONDAY/);
		}
		expect(
			calendarProblem(
				calendar({
					workingTimes: [{ weekday: "MONDAY", start: 0, end: 8 * 86_400_000 }],
				}),
			),
		).toMatch(/working time/);
		expect(
			calendarProblem(
				calendar({
					workingTimes: Array.from({ length: 1001 }, () => ({
						weekday: "MONDAY",
						start: 0,
						end: HOUR,
					})),
				}),
			),
		).toMatch(/more than 1000 working times/);
	});

	test("a holiday span or total that is too long is refused", () => {
		expect(
			calendarProblem(
				calendar({
					holidays: [{ startDate: "2026-01-01", endDate: "5000-01-01" }],
				}),
			),
		).toMatch(/a holiday spans more than 366 days/);
		expect(
			calendarProblem(
				calendar({
					holidays: Array.from({ length: 60 }, () => ({
						startDate: "2026-01-01",
						endDate: "2026-12-31",
					})),
				}),
			),
		).toMatch(/holidays cover more than 20000 days/);
		expect(
			calendarProblem(calendar({ holidays: [{ startDate: "not a date" }] })),
		).toBeNull();
	});

	test("a refused calendar and its goals leave the rest of the dataset in place", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const base = serviceDeskFixtureDataset();
			const [first, second] = base.slaCalendars as JiraWorkingCalendar[];
			const dataset: JiraDataset = {
				...base,
				slaCalendars: [
					{
						...first,
						workingTimes: [{ weekday: "MONDAY", start: 1e308, end: 1e308 }],
					},
					second,
				],
			};

			const kept = withoutBadCalendars(dataset);

			expect(kept.slaCalendars?.map((item) => item.id)).toEqual([second.id]);
			const goalCalendars = (kept.serviceDesks ?? []).flatMap((desk) =>
				desk.metrics.flatMap((metric) =>
					(metric.config?.goals ?? []).map((goal) => goal.calendarId),
				),
			);
			expect(goalCalendars).toEqual([second.id]);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining(`SLA calendar ${first.id} was not imported`),
			);
			expect(withoutBadCalendars(base)).toBe(base);
		} finally {
			warn.mockRestore();
		}
	});

	test("the working hours of a calendar that passes map in a bounded number of steps", () => {
		const hours = mapWorkingHours(
			calendar({
				workingTimes: [
					{ weekday: "SATURDAY", start: 0, end: 7 * 86_400_000 },
					{ weekday: "SUNDAY", start: 6 * 86_400_000, end: 7 * 86_400_000 },
				],
			}),
		);
		expect(hours.flat().length).toBeLessThan(40);
	});
});
