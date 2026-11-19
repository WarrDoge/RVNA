import { expect, test } from "vitest";
import { formatDuration, parseDuration, shortDate } from "../src/lib/dates.ts";

test("durations keep the seconds remainder", () => {
	expect(formatDuration(90)).toBe("1m 30s");
	expect(formatDuration(3661)).toBe("1h 1m 1s");
	expect(formatDuration(3601)).toBe("1h 1s");
});

test("a formatted duration parses back to the same number of seconds", () => {
	for (const seconds of [0, 45, 60, 90, 3599, 3600, 3601, 3661]) {
		expect(parseDuration(formatDuration(seconds))).toBe(seconds);
	}
});

test("a short date is dd/MMM/yy in the local zone", () => {
	expect(shortDate(new Date(2026, 8, 5, 12).toISOString())).toBe("05/Sep/26");
	expect(shortDate(null)).toBe("");
	expect(shortDate("not a date")).toBe("");
});
