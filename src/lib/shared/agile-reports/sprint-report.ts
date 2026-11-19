import { replayIssue } from "./replay.ts";
import type {
	ReportIssue,
	SprintEvent,
	SprintInfo,
	SprintIssueState,
} from "./types.ts";

export type SprintReportRow = {
	issue: ReportIssue;
	estimateAtStart: number;
	estimateAtEnd: number;
	estimateAtRemoval: number;
	statusAtEnd: ReportIssue["status"]["category"];
	addedDuringSprint: boolean;
	completedAt: string | null;
};

export type SprintReportSums = {
	completedInitial: number;
	completedCurrent: number;
	notCompletedInitial: number;
	notCompletedCurrent: number;
	removedInitial: number;
	removedCurrent: number;
	totalInitial: number;
	totalCurrent: number;
};

export type SprintReportResult = {
	completed: SprintReportRow[];
	notCompleted: SprintReportRow[];
	removed: SprintReportRow[];
	addedDuringSprint: string[];
	sums: SprintReportSums;
};

export type SprintReportInput = {
	sprint: SprintInfo;
	issues: ReportIssue[];
	events: SprintEvent[];
};

function row(state: SprintIssueState): SprintReportRow {
	return {
		issue: state.issue,
		estimateAtStart: state.estimateAtStart,
		estimateAtEnd: state.estimateAtEnd,
		estimateAtRemoval: state.estimateAtRemoval,
		statusAtEnd: state.statusAtEnd,
		addedDuringSprint: state.addedAt !== null,
		completedAt: state.completedAt,
	};
}

export function replaySprintIssues(
	input: SprintReportInput,
): SprintIssueState[] {
	const start = input.sprint.startDate;
	const end =
		input.sprint.completeDate ??
		input.sprint.endDate ??
		input.sprint.startDate ??
		new Date().toISOString();
	if (!start) return [];
	const byIssue = new Map<string, SprintEvent[]>();
	for (const event of input.events) {
		const list = byIssue.get(event.issueId) ?? [];
		list.push(event);
		byIssue.set(event.issueId, list);
	}
	return input.issues.map((issue) =>
		replayIssue(issue, byIssue.get(issue.id) ?? [], start, end),
	);
}

export function buildSprintReport(
	input: SprintReportInput,
): SprintReportResult {
	const states = replaySprintIssues(input);
	const completed: SprintReportRow[] = [];
	const notCompleted: SprintReportRow[] = [];
	const removed: SprintReportRow[] = [];
	const addedDuringSprint: string[] = [];
	const sums = {
		completedInitial: 0,
		completedCurrent: 0,
		notCompletedInitial: 0,
		notCompletedCurrent: 0,
		removedInitial: 0,
		removedCurrent: 0,
		totalInitial: 0,
		totalCurrent: 0,
	};

	for (const state of states) {
		if (state.addedAt) addedDuringSprint.push(state.issue.key);
		if (state.inScopeAtStart) sums.totalInitial += state.estimateAtStart;
		if (state.inScopeAtEnd) {
			sums.totalCurrent += state.estimateAtEnd;
			if (state.statusAtEnd === "done") {
				completed.push(row(state));
				if (state.inScopeAtStart) {
					sums.completedInitial += state.estimateAtStart;
				}
				sums.completedCurrent += state.estimateAtEnd;
			} else {
				notCompleted.push(row(state));
				if (state.inScopeAtStart) {
					sums.notCompletedInitial += state.estimateAtStart;
				}
				sums.notCompletedCurrent += state.estimateAtEnd;
			}
		} else if (state.removedAt || state.inScopeAtStart) {
			removed.push(row(state));
			if (state.inScopeAtStart) {
				sums.removedInitial += state.estimateAtStart;
			}
			sums.removedCurrent += state.estimateAtRemoval;
		}
	}

	const byKey = (left: SprintReportRow, right: SprintReportRow) =>
		left.issue.key.localeCompare(right.issue.key);
	return {
		completed: completed.sort(byKey),
		notCompleted: notCompleted.sort(byKey),
		removed: removed.sort(byKey),
		addedDuringSprint: addedDuringSprint.sort(),
		sums,
	};
}
