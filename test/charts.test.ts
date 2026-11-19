import { describe, expect, test } from "vitest";
import {
	clampIndex,
	dateLabel,
	dateTimeLabel,
	guidelinePath,
	indexScale,
	margin,
	niceMax,
	plotHeight,
	plotWidth,
	shortName,
	stackedAreaPath,
	stepPath,
	timeScale,
	valueScale,
	yTicksFor,
} from "../src/lib/charts/charts.ts";

describe("chart scales", () => {
	test("timeScale maps the ends of the range to the plot edges", () => {
		const scale = timeScale(0, 1_000);
		expect(scale(0)).toBe(margin.left);
		expect(scale(1_000)).toBe(margin.left + plotWidth);
		expect(scale(500)).toBe(margin.left + plotWidth / 2);
	});

	test("valueScale maps zero to the baseline and the maximum to the top", () => {
		const scale = valueScale(100);
		expect(scale(0)).toBe(margin.top + plotHeight);
		expect(scale(100)).toBe(margin.top);
	});

	test("clampIndex keeps a hover inside the data and rejects empty data", () => {
		expect(clampIndex(-2, 5)).toBe(0);
		expect(clampIndex(3, 5)).toBe(3);
		expect(clampIndex(9, 5)).toBe(4);
		expect(clampIndex(0, 0)).toBe(-1);
	});

	test("indexScale centers a single point and spans multiple points", () => {
		expect(indexScale(1)(0)).toBe(margin.left + plotWidth / 2);
		expect(indexScale(5)(0)).toBe(margin.left);
		expect(indexScale(5)(4)).toBe(margin.left + plotWidth);
		expect(indexScale(5)(2)).toBe(margin.left + plotWidth / 2);
	});
});

describe("chart ticks", () => {
	test("niceMax rounds up to a readable maximum", () => {
		expect(niceMax(0)).toBe(1);
		expect(niceMax(1)).toBe(1);
		expect(niceMax(7)).toBe(8);
		expect(niceMax(12)).toBe(12);
		expect(niceMax(34)).toBe(40);
		expect(niceMax(123)).toBe(150);
	});

	test("yTicksFor produces five intervals without duplicate rounded ticks", () => {
		expect(yTicksFor(40)).toEqual([0, 8, 16, 24, 32, 40]);
		expect(yTicksFor(3)).toEqual([0, 1, 2, 3]);
	});
});

describe("chart paths", () => {
	const x = (value: number) => value;
	const y = (value: number) => value;

	test("stepPath is empty without points", () => {
		expect(stepPath([], x, y)).toBe("");
	});

	test("stepPath steps horizontally before dropping vertically", () => {
		expect(
			stepPath(
				[
					{ at: "1970-01-01T00:00:01.000Z", remaining: 10 },
					{ at: "1970-01-01T00:00:02.000Z", remaining: 5 },
					{ at: "1970-01-01T00:00:03.000Z", remaining: 7 },
				],
				(value) => value / 1_000,
				y,
			),
		).toBe("M 1 10 L 2 10 L 2 5 L 3 5 L 3 7");
	});

	test("guidelinePath joins every point", () => {
		expect(
			guidelinePath(
				[
					{ at: "1970-01-01T00:00:01.000Z", remaining: 10 },
					{ at: "1970-01-01T00:00:02.000Z", remaining: 5 },
				],
				(value) => value / 1_000,
				y,
			),
		).toBe("M 1 10 L 2 5");
	});

	test("stackedAreaPath closes the top edge with the reversed bottom edge", () => {
		expect(stackedAreaPath([3, 4], [1, 2], x, y)).toBe(
			"M 0 3 L 1 4 L 1 2 L 0 1 Z",
		);
	});
});

describe("chart labels", () => {
	test("dateLabel is empty for an invalid date", () => {
		expect(dateLabel("not-a-date")).toBe("");
		expect(dateLabel("")).toBe("");
	});

	test("dateLabel uses the short month and day", () => {
		expect(dateLabel("2026-02-02T09:00:00.000Z")).toBe(
			new Intl.DateTimeFormat(undefined, {
				month: "short",
				day: "numeric",
			}).format(new Date("2026-02-02T09:00:00.000Z")),
		);
	});

	test("dateTimeLabel includes the time", () => {
		expect(dateTimeLabel("2026-02-02T09:00:00.000Z")).toBe(
			new Intl.DateTimeFormat(undefined, {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
			}).format(new Date("2026-02-02T09:00:00.000Z")),
		);
	});

	test("shortName only truncates names over the limit", () => {
		expect(shortName("Sprint alpha")).toBe("Sprint alpha");
		expect(shortName("A very long sprint name")).toBe("A very long spr…");
	});
});
