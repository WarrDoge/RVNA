import type {
	ReportIssue,
	SprintEvent,
	SprintIssueState,
	StatusCategory,
} from "./types.ts";

function initialStatus(issue: ReportIssue, events: SprintEvent[]) {
	const first = events.find((event) => event.type === "status-changed");
	return first?.fromCategory ?? issue.status.category;
}

function initialEstimate(issue: ReportIssue, events: SprintEvent[]) {
	const first = events.find((event) => event.type === "estimate-changed");
	return first?.from ?? issue.estimate ?? 0;
}

function initialInScope(events: SprintEvent[]) {
	const first = events.find(
		(event) => event.type === "scope-added" || event.type === "scope-removed",
	);
	if (!first) return true;
	return first.type === "scope-removed";
}

/** Replays one issue's events up to `at` (inclusive) and returns its state. */
export function replayIssue(
	issue: ReportIssue,
	events: SprintEvent[],
	start: string,
	end: string,
): SprintIssueState {
	const sorted = [...events].sort((left, right) =>
		left.at.localeCompare(right.at),
	);
	const startTime = new Date(start).getTime();
	const endTime = new Date(end).getTime();

	let status: StatusCategory = initialStatus(issue, sorted);
	let estimate = initialEstimate(issue, sorted);
	let inScope = initialInScope(sorted);
	let inScopeAtStart = inScope;
	let statusAtStart = status;
	let estimateAtStart = estimate;
	let addedAt: string | null = null;
	let removedAt: string | null = null;
	let estimateAtRemoval = estimate;
	let completedAt: string | null = null;

	for (const event of sorted) {
		const time = new Date(event.at).getTime();
		if (time > endTime) break;
		const atStart = time <= startTime;
		if (event.type === "scope-added") {
			if (!inScope && atStart) inScopeAtStart = true;
			inScope = true;
			if (time > startTime) addedAt = event.at;
		} else if (event.type === "scope-removed") {
			if (inScope && atStart) inScopeAtStart = false;
			inScope = false;
			if (time >= startTime) {
				removedAt = event.at;
				estimateAtRemoval = estimate;
			}
		} else if (event.type === "status-changed") {
			status = event.toCategory ?? status;
			if (time >= startTime && inScope) {
				completedAt = status === "done" ? event.at : null;
			}
		} else if (event.type === "estimate-changed") {
			estimate = event.to ?? 0;
		}
		if (atStart) {
			statusAtStart = status;
			estimateAtStart = estimate;
		}
	}

	return {
		issue,
		inScopeAtStart,
		inScopeAtEnd: inScope,
		addedAt,
		removedAt,
		estimateAtStart,
		estimateAtEnd: estimate,
		estimateAtRemoval,
		statusAtStart,
		statusAtEnd: status,
		completedAt,
		completed: inScope && status === "done",
	};
}
