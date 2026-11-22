import { workingMillisecondsBetween } from "./calendar.ts";
import type {
	SlaCondition,
	SlaCycle,
	SlaCycleInput,
	SlaEvent,
	SlaGoal,
} from "./types.ts";

const MINUTE_MS = 60_000;

interface IssueState {
	statusId: string | null;
	assigneeId: string | null;
	resolutionId: string | null;
}

interface OpenCycle {
	startedAt: number;
	pausedAt: number | null;
	pauses: { from: number; to: number }[];
}

function applyEvent(state: IssueState, event: SlaEvent) {
	switch (event.kind) {
		case "status":
			state.statusId = event.statusId;
			break;
		case "assignee":
			state.assigneeId = event.assigneeId;
			break;
		case "resolution":
			state.resolutionId = event.resolutionId;
			break;
	}
}

function conditionHolds(condition: SlaCondition, state: IssueState): boolean {
	switch (condition.type) {
		case "entered_status":
			return state.statusId === condition.statusId;
		case "assignee_cleared":
			return state.assigneeId === null;
		case "assignee_set":
			return state.assigneeId !== null;
		case "resolution_cleared":
			return state.resolutionId === null;
		case "resolution_set":
			return state.resolutionId !== null;
		default:
			return false;
	}
}

function eventHits(condition: SlaCondition, event: SlaEvent): boolean {
	switch (condition.type) {
		case "issue_created":
			return event.kind === "created";
		case "entered_status":
			return event.kind === "status" && event.statusId === condition.statusId;
		case "comment_by_customer":
			return event.kind === "comment" && event.author === "customer";
		case "comment_for_customer":
			return (
				event.kind === "comment" && event.author === "agent" && !event.internal
			);
		case "assignee_set":
			return event.kind === "assignee" && event.assigneeId !== null;
		case "assignee_cleared":
			return event.kind === "assignee" && event.assigneeId === null;
		case "resolution_set":
			return event.kind === "resolution" && event.resolutionId !== null;
		case "resolution_cleared":
			return event.kind === "resolution" && event.resolutionId === null;
	}
}

function elapsedAt(
	calendar: SlaGoal["calendar"],
	startedAt: number,
	pauses: { from: number; to: number }[],
	at: number,
): number {
	if (at <= startedAt) return 0;
	let total = workingMillisecondsBetween(
		calendar,
		new Date(startedAt),
		new Date(at),
	);
	for (const pause of pauses) {
		const from = Math.max(pause.from, startedAt);
		const to = Math.min(pause.to, at);
		if (to > from) {
			total -= workingMillisecondsBetween(
				calendar,
				new Date(from),
				new Date(to),
			);
		}
	}
	return Math.max(0, total);
}

function firstBreachInstant(
	calendar: SlaGoal["calendar"],
	startedAt: number,
	pauses: { from: number; to: number }[],
	end: number,
	goalMs: number,
): number | null {
	if (goalMs <= 0) return startedAt;
	if (elapsedAt(calendar, startedAt, pauses, end) < goalMs) return null;

	let low = startedAt;
	let high = end;
	while (high - low > 1) {
		const middle = Math.floor((low + high) / 2);
		if (elapsedAt(calendar, startedAt, pauses, middle) >= goalMs) {
			high = middle;
		} else {
			low = middle;
		}
	}
	return high;
}

function finishCycle(
	open: OpenCycle,
	stoppedAt: number | null,
	goal: SlaGoal,
	now: number,
	cycle: number,
): SlaCycle {
	const end = stoppedAt ?? now;
	const pauses = open.pauses.map((pause) => ({ ...pause }));
	if (open.pausedAt !== null) {
		pauses.push({ from: open.pausedAt, to: end });
	}
	const closedPauses = pauses.filter((pause) => pause.to > pause.from);

	const elapsedMs = elapsedAt(goal.calendar, open.startedAt, closedPauses, end);
	const goalMs = goal.minutes === null ? null : goal.minutes * MINUTE_MS;
	const breachInstant =
		goalMs === null
			? null
			: firstBreachInstant(
					goal.calendar,
					open.startedAt,
					closedPauses,
					end,
					goalMs,
				);

	return {
		cycle,
		startedAt: new Date(open.startedAt),
		stoppedAt: stoppedAt === null ? null : new Date(stoppedAt),
		pausedIntervals: closedPauses.map((pause) => ({
			from: new Date(pause.from),
			to: new Date(pause.to),
		})),
		pausedAt:
			stoppedAt === null && open.pausedAt !== null
				? new Date(open.pausedAt)
				: null,
		goalMinutes: goal.minutes,
		elapsedMinutes: Math.round(elapsedMs / MINUTE_MS),
		remainingMinutes:
			goalMs === null ? null : Math.round((goalMs - elapsedMs) / MINUTE_MS),
		breachTime: breachInstant === null ? null : new Date(breachInstant),
		breached: goalMs !== null && elapsedMs > goalMs,
	};
}

/**
 * Replays an issue's events against one metric and returns its cycles.
 *
 * Start and stop conditions fire on events. Pause conditions describe a state:
 * a cycle pauses when one becomes true and resumes when none is true. A cycle
 * that stops followed by another start event produces the next cycle number.
 */
export function computeSlaCycles(input: SlaCycleInput): SlaCycle[] {
	const events = [...input.events].sort(
		(left, right) => left.at.getTime() - right.at.getTime(),
	);
	const state: IssueState = {
		statusId: null,
		assigneeId: null,
		resolutionId: null,
	};
	const cycles: SlaCycle[] = [];
	const now = input.now.getTime();
	let open: OpenCycle | null = null;

	const close = (stoppedAt: number | null) => {
		if (!open) return;
		cycles.push(
			finishCycle(open, stoppedAt, input.goal, now, cycles.length + 1),
		);
		open = null;
	};

	for (const event of events) {
		const at = event.at.getTime();
		applyEvent(state, event);

		if (open) {
			const paused = input.metric.pause.some((condition) =>
				conditionHolds(condition, state),
			);
			if (open.pausedAt !== null && !paused) {
				open.pauses.push({ from: open.pausedAt, to: at });
				open.pausedAt = null;
			} else if (open.pausedAt === null && paused) {
				open.pausedAt = at;
			}

			if (input.metric.stop.some((condition) => eventHits(condition, event))) {
				close(at);
			}
		}

		if (
			!open &&
			input.metric.start.some((condition) => eventHits(condition, event))
		) {
			const paused = input.metric.pause.some((condition) =>
				conditionHolds(condition, state),
			);
			open = { startedAt: at, pausedAt: paused ? at : null, pauses: [] };
		}
	}

	close(null);
	return cycles;
}
