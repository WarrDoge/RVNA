import { describe, expect, test } from "vitest";
import {
	computeSlaCycles,
	type SlaCalendar,
	type SlaEvent,
	type SlaMetricConditions,
} from "../src/lib/shared/sla/index.ts";

const workday = [{ start: 9 * 60, end: 17 * 60 }];
const calendar: SlaCalendar = {
	timezone: "Etc/UTC",
	workingHours: [workday, workday, workday, workday, workday, [], []],
	holidays: [],
};

const created = (iso: string): SlaEvent => ({
	kind: "created",
	at: new Date(iso),
});
const status = (iso: string, statusId: string): SlaEvent => ({
	kind: "status",
	at: new Date(iso),
	statusId,
});
const resolution = (iso: string, resolutionId: string | null): SlaEvent => ({
	kind: "resolution",
	at: new Date(iso),
	resolutionId,
});
const comment = (
	iso: string,
	author: "customer" | "agent",
	internal = false,
): SlaEvent => ({ kind: "comment", at: new Date(iso), author, internal });

const metric: SlaMetricConditions = {
	start: [{ type: "issue_created" }],
	pause: [],
	stop: [{ type: "resolution_set" }],
};

function run(
	events: SlaEvent[],
	now: string,
	goalMinutes: number | null = 480,
	overrides: Partial<SlaMetricConditions> = {},
) {
	return computeSlaCycles({
		metric: { ...metric, ...overrides },
		goal: { minutes: goalMinutes, calendar },
		events,
		now: new Date(now),
	});
}

describe("cycle computation", () => {
	test("starts on creation and stops on resolution", () => {
		const [cycle] = run(
			[
				created("2026-01-05T09:00:00Z"),
				resolution("2026-01-05T13:00:00Z", "done"),
			],
			"2026-01-10T00:00:00Z",
		);
		expect(cycle.cycle).toBe(1);
		expect(cycle.startedAt.toISOString()).toBe("2026-01-05T09:00:00.000Z");
		expect(cycle.stoppedAt?.toISOString()).toBe("2026-01-05T13:00:00.000Z");
		expect(cycle.elapsedMinutes).toBe(240);
		expect(cycle.remainingMinutes).toBe(240);
		expect(cycle.breachTime).toBeNull();
		expect(cycle.breached).toBe(false);
		expect(cycle.pausedIntervals).toEqual([]);
	});

	test("pauses while a status condition holds and resumes after it", () => {
		const [cycle] = run(
			[
				created("2026-01-05T09:00:00Z"),
				status("2026-01-05T10:00:00Z", "waiting"),
				status("2026-01-05T12:00:00Z", "open"),
				resolution("2026-01-05T13:00:00Z", "done"),
			],
			"2026-01-10T00:00:00Z",
			480,
			{ pause: [{ type: "entered_status", statusId: "waiting" }] },
		);
		expect(
			cycle.pausedIntervals.map((pause) => pause.from.toISOString()),
		).toEqual(["2026-01-05T10:00:00.000Z"]);
		expect(
			cycle.pausedIntervals.map((pause) => pause.to.toISOString()),
		).toEqual(["2026-01-05T12:00:00.000Z"]);
		expect(cycle.elapsedMinutes).toBe(120);
	});

	test("a reopen starts a second cycle", () => {
		const cycles = run(
			[
				created("2026-01-05T09:00:00Z"),
				resolution("2026-01-05T10:00:00Z", "done"),
				resolution("2026-01-05T11:00:00Z", null),
				resolution("2026-01-05T12:00:00Z", "done"),
			],
			"2026-01-10T00:00:00Z",
			480,
			{
				start: [{ type: "issue_created" }, { type: "resolution_cleared" }],
			},
		);
		expect(cycles).toHaveLength(2);
		expect(cycles.map((cycle) => cycle.cycle)).toEqual([1, 2]);
		expect(cycles[0].startedAt.toISOString()).toBe("2026-01-05T09:00:00.000Z");
		expect(cycles[0].stoppedAt?.toISOString()).toBe("2026-01-05T10:00:00.000Z");
		expect(cycles[1].startedAt.toISOString()).toBe("2026-01-05T11:00:00.000Z");
		expect(cycles[1].elapsedMinutes).toBe(60);
	});

	test("a different goal changes breach and remaining", () => {
		const events = [
			created("2026-01-05T09:00:00Z"),
			resolution("2026-01-05T10:30:00Z", "done"),
		];
		const [short] = run(events, "2026-01-10T00:00:00Z", 60);
		const [long] = run(events, "2026-01-10T00:00:00Z", 120);
		expect(short.elapsedMinutes).toBe(90);
		expect(short.breached).toBe(true);
		expect(short.breachTime?.toISOString()).toBe("2026-01-05T10:00:00.000Z");
		expect(short.remainingMinutes).toBe(-30);
		expect(long.breached).toBe(false);
		expect(long.breachTime).toBeNull();
		expect(long.remainingMinutes).toBe(30);
	});

	test("exactly at the goal is not a breach", () => {
		const [cycle] = run(
			[created("2026-01-05T09:00:00Z")],
			"2026-01-05T17:00:00Z",
		);
		expect(cycle.elapsedMinutes).toBe(480);
		expect(cycle.remainingMinutes).toBe(0);
		expect(cycle.breached).toBe(false);
		expect(cycle.breachTime?.toISOString()).toBe("2026-01-05T17:00:00.000Z");
	});

	test("past the goal breaches at the boundary instant", () => {
		const [cycle] = run(
			[created("2026-01-05T09:00:00Z")],
			"2026-01-06T09:01:00Z",
		);
		expect(cycle.elapsedMinutes).toBe(481);
		expect(cycle.breached).toBe(true);
		expect(cycle.breachTime?.toISOString()).toBe("2026-01-05T17:00:00.000Z");
		expect(cycle.remainingMinutes).toBe(-1);
	});

	test("an ongoing cycle has no stop and counts up to now", () => {
		const [cycle] = run(
			[created("2026-01-05T09:00:00Z")],
			"2026-01-05T12:30:00Z",
		);
		expect(cycle.stoppedAt).toBeNull();
		expect(cycle.elapsedMinutes).toBe(210);
		expect(cycle.remainingMinutes).toBe(270);
	});

	test("a pause shifts the breach time", () => {
		const [cycle] = run(
			[
				created("2026-01-05T09:00:00Z"),
				status("2026-01-05T10:00:00Z", "waiting"),
				status("2026-01-05T11:00:00Z", "open"),
			],
			"2026-01-05T12:00:00Z",
			120,
			{ pause: [{ type: "entered_status", statusId: "waiting" }] },
		);
		expect(cycle.elapsedMinutes).toBe(120);
		expect(cycle.breached).toBe(false);
		expect(cycle.breachTime?.toISOString()).toBe("2026-01-05T12:00:00.000Z");
	});

	test("a null goal never breaches", () => {
		const [cycle] = run(
			[
				created("2026-01-05T09:00:00Z"),
				resolution("2026-01-20T10:00:00Z", "done"),
			],
			"2026-01-25T00:00:00Z",
			null,
		);
		expect(cycle.goalMinutes).toBeNull();
		expect(cycle.remainingMinutes).toBeNull();
		expect(cycle.breachTime).toBeNull();
		expect(cycle.breached).toBe(false);
	});

	test("no cycle when no start condition fires", () => {
		expect(
			run([created("2026-01-05T09:00:00Z")], "2026-01-06T00:00:00Z", 60, {
				start: [{ type: "entered_status", statusId: "open" }],
			}),
		).toEqual([]);
	});

	test("a customer comment does not count as a reply for the customer", () => {
		const [cycle] = run(
			[
				created("2026-01-05T09:00:00Z"),
				comment("2026-01-05T09:30:00Z", "customer"),
				comment("2026-01-05T09:45:00Z", "agent", true),
				comment("2026-01-05T10:00:00Z", "agent"),
			],
			"2026-01-10T00:00:00Z",
			480,
			{ stop: [{ type: "comment_for_customer" }] },
		);
		expect(cycle.stoppedAt?.toISOString()).toBe("2026-01-05T10:00:00.000Z");
		expect(cycle.elapsedMinutes).toBe(60);
	});

	test("a customer comment stops a comment_by_customer metric", () => {
		const [cycle] = run(
			[
				created("2026-01-05T09:00:00Z"),
				comment("2026-01-05T09:30:00Z", "agent"),
				comment("2026-01-05T09:45:00Z", "customer"),
			],
			"2026-01-10T00:00:00Z",
			480,
			{ stop: [{ type: "comment_by_customer" }] },
		);
		expect(cycle.stoppedAt?.toISOString()).toBe("2026-01-05T09:45:00.000Z");
	});
});
