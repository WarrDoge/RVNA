import { describe, expect, test } from "vitest";
import {
	buildBurndown,
	buildCumulativeFlow,
	buildSprintReport,
	buildVelocity,
	type ReportIssue,
	type SprintEvent,
} from "../src/lib/shared/agile-reports/index.ts";

function issue(
	key: string,
	estimate: number | null,
	status: "new" | "indeterminate" | "done" = "new",
): ReportIssue {
	return {
		id: key,
		key,
		summary: `Fixture ${key}`,
		typeName: "Task",
		status: { id: `${key}-status`, name: status, category: status },
		assignee: null,
		estimate,
		created: "2026-01-01T09:00:00.000Z",
	};
}

function event(
	at: string,
	type: SprintEvent["type"],
	issueKey: string,
	extra: Partial<SprintEvent> = {},
): SprintEvent {
	return {
		at,
		type,
		issueId: issueKey,
		issueKey,
		...extra,
	};
}

describe("buildBurndown", () => {
	test("steps through scope changes, completion, reopening and estimate changes", () => {
		const issues = [issue("A", 5), issue("B", 3), issue("C", 2)];
		const events: SprintEvent[] = [
			event("2026-01-05T09:00:00.000Z", "scope-added", "A"),
			event("2026-01-05T09:00:00.000Z", "scope-added", "B"),
			event("2026-01-07T10:00:00.000Z", "scope-added", "C"),
			event("2026-01-08T11:00:00.000Z", "scope-removed", "B"),
			event("2026-01-09T12:00:00.000Z", "status-changed", "A", {
				fromCategory: "new",
				toCategory: "done",
			}),
			event("2026-01-12T09:30:00.000Z", "status-changed", "A", {
				fromCategory: "done",
				toCategory: "indeterminate",
			}),
			event("2026-01-13T14:00:00.000Z", "estimate-changed", "A", {
				from: 5,
				to: 8,
			}),
		];

		const result = buildBurndown({
			start: "2026-01-05T09:00:00.000Z",
			end: "2026-01-16T18:00:00.000Z",
			issues,
			events,
		});

		expect(result.initialScope).toBe(8);
		expect(result.points.map((point) => point.remaining)).toEqual([
			8, 10, 7, 2, 7, 10, 10,
		]);
		expect(result.eventRows.map((row) => row.eventType)).toEqual([
			"scope-added",
			"scope-removed",
			"completed",
			"reopened",
			"estimate-changed",
		]);
		expect(result.eventRows.at(-1)?.remaining).toBe(10);
		expect(result.totalIncrease).toBe(10);
		expect(result.totalDecrease).toBe(8);
		expect(result.nonWorkingDays).toContain("2026-01-10");
		expect(result.nonWorkingDays).toContain("2026-01-11");
		expect(result.guideline).toHaveLength(10);
	});

	test("handles a sprint with no estimates", () => {
		const result = buildBurndown({
			start: "2026-02-02T09:00:00.000Z",
			end: "2026-02-06T18:00:00.000Z",
			issues: [issue("A", null), issue("B", null)],
			events: [
				event("2026-02-02T09:00:00.000Z", "scope-added", "A"),
				event("2026-02-02T09:00:00.000Z", "scope-added", "B"),
				event("2026-02-04T12:00:00.000Z", "status-changed", "A", {
					fromCategory: "new",
					toCategory: "done",
				}),
			],
		});

		expect(result.initialScope).toBe(0);
		expect(result.points.every((point) => point.remaining === 0)).toBe(true);
		expect(result.eventRows[0]).toMatchObject({
			eventType: "completed",
			decrease: 0,
			remaining: 0,
		});
	});
});

describe("buildSprintReport", () => {
	test("buckets completed, not completed, removed and added issues", () => {
		const issues = [
			issue("A", 5),
			issue("B", 3),
			issue("C", 2),
			issue("D", 4),
			issue("E", 1),
			issue("F", 8, "done"),
		];
		const sprint = {
			id: "sprint-1",
			name: "Fixture sprint",
			state: "closed" as const,
			startDate: "2026-01-05T09:00:00.000Z",
			endDate: "2026-01-16T18:00:00.000Z",
			completeDate: "2026-01-16T18:00:00.000Z",
		};
		const events: SprintEvent[] = [
			event("2026-01-05T09:00:00.000Z", "scope-added", "A"),
			event("2026-01-05T09:00:00.000Z", "scope-added", "B"),
			event("2026-01-05T09:00:00.000Z", "scope-added", "C"),
			event("2026-01-05T09:00:00.000Z", "scope-added", "F"),
			event("2026-01-07T10:00:00.000Z", "scope-added", "D"),
			event("2026-01-07T10:00:00.000Z", "scope-added", "E"),
			event("2026-01-09T12:00:00.000Z", "scope-removed", "C"),
			event("2026-01-10T12:00:00.000Z", "scope-removed", "E"),
			event("2026-01-09T15:00:00.000Z", "status-changed", "A", {
				fromCategory: "new",
				toCategory: "done",
			}),
			event("2026-01-12T09:30:00.000Z", "status-changed", "A", {
				fromCategory: "done",
				toCategory: "indeterminate",
			}),
			event("2026-01-15T09:30:00.000Z", "status-changed", "A", {
				fromCategory: "indeterminate",
				toCategory: "done",
			}),
			event("2026-01-11T09:30:00.000Z", "status-changed", "D", {
				fromCategory: "new",
				toCategory: "done",
			}),
			event("2026-01-10T09:30:00.000Z", "status-changed", "F", {
				fromCategory: "done",
				toCategory: "indeterminate",
			}),
		];

		const report = buildSprintReport({ sprint, issues, events });

		expect(report.completed.map((row) => row.issue.key)).toEqual(["A", "D"]);
		expect(report.notCompleted.map((row) => row.issue.key)).toEqual(["B", "F"]);
		expect(report.removed.map((row) => row.issue.key)).toEqual(["C", "E"]);
		expect(report.addedDuringSprint).toEqual(["D", "E"]);
		expect(report.sums).toMatchObject({
			completedInitial: 5,
			completedCurrent: 9,
			notCompletedInitial: 11,
			notCompletedCurrent: 11,
			removedInitial: 2,
			removedCurrent: 3,
			totalInitial: 18,
			totalCurrent: 20,
		});
	});
});

describe("buildVelocity", () => {
	test("uses the last seven closed sprints and averages completed work", () => {
		const sprints = Array.from({ length: 9 }, (_, index) => ({
			id: String(index),
			name: `Sprint ${index + 1}`,
			startDate: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
			endDate: `2026-01-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`,
			completeDate: `2026-01-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`,
			commitment: index + 1,
			completed: index + 2,
		}));

		const result = buildVelocity(sprints);

		expect(result.sprints.map((sprint) => sprint.name)).toEqual([
			"Sprint 3",
			"Sprint 4",
			"Sprint 5",
			"Sprint 6",
			"Sprint 7",
			"Sprint 8",
			"Sprint 9",
		]);
		expect(result.averageCompleted).toBe(7);
		expect(result.averageCommitment).toBe(6);
	});
});

describe("buildCumulativeFlow", () => {
	test("counts issues per column for every day in the range", () => {
		const columns = [
			{ id: "todo", name: "To Do", sequence: 0, statusIds: ["todo"] },
			{
				id: "progress",
				name: "In Progress",
				sequence: 1,
				statusIds: ["progress"],
			},
			{ id: "done", name: "Done", sequence: 2, statusIds: ["done"] },
		];
		const issues = [
			{
				id: "A",
				key: "A-1",
				created: "2026-01-01T09:00:00.000Z",
				statusId: "done",
				statusChanges: [
					{
						at: "2026-01-03T10:00:00.000Z",
						fromStatusId: "todo",
						toStatusId: "progress",
					},
					{
						at: "2026-01-05T10:00:00.000Z",
						fromStatusId: "progress",
						toStatusId: "done",
					},
				],
			},
			{
				id: "B",
				key: "B-1",
				created: "2026-01-04T09:00:00.000Z",
				statusId: "todo",
				statusChanges: [],
			},
		];

		const result = buildCumulativeFlow({
			from: "2026-01-01",
			to: "2026-01-06",
			columns,
			issues,
		});

		expect(result.dates).toEqual([
			"2026-01-01",
			"2026-01-02",
			"2026-01-03",
			"2026-01-04",
			"2026-01-05",
			"2026-01-06",
		]);
		expect(result.series.map((series) => series.values)).toEqual([
			[1, 1, 0, 1, 1, 1],
			[0, 0, 1, 1, 0, 0],
			[0, 0, 0, 0, 1, 1],
		]);
		expect(result.total).toEqual([1, 1, 1, 2, 2, 2]);
	});
});
