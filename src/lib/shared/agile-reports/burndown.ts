import { replayIssue } from "./replay.ts";
import {
	daysBetween,
	nonWorkingDates,
	type ReportIssue,
	type SprintEvent,
} from "./types.ts";

export type BurndownPoint = {
	at: string;
	remaining: number;
};

export type BurndownEventRow = {
	at: string;
	issueKey: string;
	issueSummary: string;
	eventType:
		| "scope-added"
		| "scope-removed"
		| "completed"
		| "reopened"
		| "estimate-changed";
	increase: number;
	decrease: number;
	remaining: number;
};

export type BurndownResult = {
	points: BurndownPoint[];
	guideline: { at: string; remaining: number }[];
	eventRows: BurndownEventRow[];
	nonWorkingDays: string[];
	initialScope: number;
	remainingAtEnd: number;
	totalIncrease: number;
	totalDecrease: number;
};

export type BurndownInput = {
	start: string;
	end: string;
	completeAt?: string | null;
	issues: ReportIssue[];
	events: SprintEvent[];
	nonWorkingWeekdays?: number[];
	nonWorkingExtra?: string[];
};

type MutableState = {
	inScope: boolean;
	estimate: number;
	status: "new" | "indeterminate" | "done";
};

export function buildBurndown(input: BurndownInput): BurndownResult {
	const start = input.start;
	const end = input.completeAt ?? input.end;
	const startTime = new Date(start).getTime();
	const endTime = new Date(end).getTime();
	const byIssue = new Map<string, SprintEvent[]>();
	for (const event of input.events) {
		const list = byIssue.get(event.issueId) ?? [];
		list.push(event);
		byIssue.set(event.issueId, list);
	}

	const states = new Map<string, MutableState>();
	for (const issue of input.issues) {
		const replay = replayIssue(issue, byIssue.get(issue.id) ?? [], start, end);
		states.set(issue.id, {
			inScope: replay.inScopeAtStart,
			estimate: replay.estimateAtStart,
			status: replay.statusAtStart,
		});
	}

	const remainingAtStart = [...states.values()].reduce(
		(sum, state) =>
			sum + (state.inScope && state.status !== "done" ? state.estimate : 0),
		0,
	);

	const points: BurndownPoint[] = [{ at: start, remaining: remainingAtStart }];
	const eventRows: BurndownEventRow[] = [];
	let remaining = remainingAtStart;
	let totalIncrease = 0;
	let totalDecrease = 0;

	const futureEvents = input.events
		.filter((event) => {
			const time = new Date(event.at).getTime();
			return time > startTime && time <= endTime;
		})
		.sort((left, right) => left.at.localeCompare(right.at));

	const issueById = new Map(input.issues.map((issue) => [issue.id, issue]));
	for (const event of futureEvents) {
		const state = states.get(event.issueId);
		const issue = issueById.get(event.issueId);
		if (!state || !issue) continue;
		let increase = 0;
		let decrease = 0;
		let eventType: BurndownEventRow["eventType"] | null = null;

		if (event.type === "scope-added") {
			if (!state.inScope) {
				state.inScope = true;
				if (state.status !== "done") {
					increase = state.estimate;
					remaining += increase;
				}
				eventType = "scope-added";
			}
		} else if (event.type === "scope-removed") {
			if (state.inScope) {
				state.inScope = false;
				if (state.status !== "done") {
					decrease = state.estimate;
					remaining -= decrease;
				}
				eventType = "scope-removed";
			}
		} else if (event.type === "status-changed") {
			const wasDone = state.status === "done";
			state.status = event.toCategory ?? state.status;
			const isDone = state.status === "done";
			if (state.inScope && wasDone !== isDone) {
				if (isDone) {
					decrease = state.estimate;
					remaining -= decrease;
					eventType = "completed";
				} else {
					increase = state.estimate;
					remaining += increase;
					eventType = "reopened";
				}
			}
		} else if (event.type === "estimate-changed") {
			const next = event.to ?? 0;
			const delta = next - state.estimate;
			state.estimate = next;
			if (state.inScope && state.status !== "done" && delta !== 0) {
				if (delta > 0) increase = delta;
				else decrease = -delta;
				remaining += delta;
				eventType = "estimate-changed";
			}
		}

		if (eventType) {
			totalIncrease += increase;
			totalDecrease += decrease;
			eventRows.push({
				at: event.at,
				issueKey: issue.key,
				issueSummary: issue.summary,
				eventType,
				increase,
				decrease,
				remaining,
			});
			points.push({ at: event.at, remaining });
		}
	}

	if (points[points.length - 1]?.at !== end) {
		points.push({ at: end, remaining });
	}

	const nonWorking = nonWorkingDates(
		start,
		end,
		input.nonWorkingWeekdays ?? [0, 6],
		input.nonWorkingExtra ?? [],
	);
	const workingDays = daysBetween(start, end).filter(
		(date) => !nonWorking.includes(date),
	);
	const guideline = workingDays.map((date, index) => ({
		at: `${date}T00:00:00.000Z`,
		remaining:
			workingDays.length <= 1
				? 0
				: remainingAtStart * (1 - index / (workingDays.length - 1)),
	}));

	return {
		points,
		guideline,
		eventRows,
		nonWorkingDays: nonWorking,
		initialScope: remainingAtStart,
		remainingAtEnd: remaining,
		totalIncrease,
		totalDecrease,
	};
}
