import { expect, test } from "vitest";
import {
	displayCycle,
	type StoredCycle,
} from "../src/lib/server/servicedesk/sla.ts";
import type { SlaCalendar } from "../src/lib/shared/sla/index.ts";

const day = [{ start: 0, end: 1440 }];
const calendar: SlaCalendar = {
	timezone: "UTC",
	workingHours: [day, day, day, day, day, day, day],
	holidays: [],
};

function cycle(overrides: Partial<StoredCycle>): StoredCycle {
	return {
		cycleNumber: 1,
		startedAt: new Date("2026-01-05T09:00:00Z"),
		stoppedAt: null,
		pausedIntervals: [],
		pausedAt: null,
		goalId: null,
		goalMinutes: 480,
		elapsedMinutes: 0,
		breached: false,
		breachTime: null,
		computedAt: new Date("2026-01-05T12:00:00Z"),
		...overrides,
	};
}

test("a pause resumed when the cycle was rebuilt does not freeze the clock", () => {
	const stored = cycle({
		pausedIntervals: [
			{ from: "2026-01-05T10:00:00.000Z", to: "2026-01-05T12:00:00.000Z" },
		],
	});
	const display = displayCycle(
		stored,
		calendar,
		new Date("2026-01-05T13:00:00Z"),
	);
	expect(display.state).toBe("ongoing");
	expect(display.elapsedMinutes).toBe(120);
});

test("an explicitly paused cycle stays paused when its interval is older", () => {
	const stored = cycle({
		pausedIntervals: [
			{ from: "2026-01-05T10:00:00.000Z", to: "2026-01-05T11:00:00.000Z" },
		],
		pausedAt: new Date("2026-01-05T10:00:00Z"),
	});
	const display = displayCycle(
		stored,
		calendar,
		new Date("2026-01-05T13:00:00Z"),
	);
	expect(display.state).toBe("paused");
	expect(display.elapsedMinutes).toBe(60);
});

test("an open cycle without a calendar still counts up to now", () => {
	const stored = cycle({ goalMinutes: 60, elapsedMinutes: 0 });
	const display = displayCycle(stored, null, new Date("2026-01-05T11:00:00Z"));
	expect(display.elapsedMinutes).toBe(120);
	expect(display.remainingMinutes).toBe(-60);
	expect(display.state).toBe("breached");
});

test("a live breach reports the instant the goal was crossed", () => {
	const stored = cycle({ goalMinutes: 60, elapsedMinutes: 0 });
	const display = displayCycle(
		stored,
		calendar,
		new Date("2026-01-05T11:00:00Z"),
	);
	expect(display.state).toBe("breached");
	expect(display.breachTime).toBe("2026-01-05T10:00:00.000Z");
});
