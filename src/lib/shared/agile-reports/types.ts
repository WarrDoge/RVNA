export type StatusCategory = "new" | "indeterminate" | "done";

export type EstimationStatistic =
	| "story_points"
	| "original_estimate"
	| "issue_count";

export type SprintState = "future" | "active" | "closed";

export type ReportIssue = {
	id: string;
	key: string;
	summary: string;
	typeName: string;
	status: { id: string; name: string; category: StatusCategory };
	assignee: string | null;
	estimate: number | null;
	created: string | null;
};

export type SprintInfo = {
	id: string;
	name: string;
	state: SprintState;
	startDate: string | null;
	endDate: string | null;
	completeDate: string | null;
};

export type SprintEventType =
	| "scope-added"
	| "scope-removed"
	| "status-changed"
	| "estimate-changed"
	| "issue-created";

export type SprintEvent = {
	at: string;
	type: SprintEventType;
	issueId: string;
	issueKey: string;
	from?: number | null;
	to?: number | null;
	fromCategory?: StatusCategory;
	toCategory?: StatusCategory;
};

export type SprintIssueState = {
	issue: ReportIssue;
	inScopeAtStart: boolean;
	inScopeAtEnd: boolean;
	addedAt: string | null;
	removedAt: string | null;
	estimateAtStart: number;
	estimateAtEnd: number;
	estimateAtRemoval: number;
	statusAtStart: StatusCategory;
	statusAtEnd: StatusCategory;
	completedAt: string | null;
	completed: boolean;
};

export function dateKey(value: string | Date): string {
	const date = value instanceof Date ? value : new Date(value);
	return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
	const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString();
}

export function daysBetween(from: string, to: string): string[] {
	const result: string[] = [];
	let current = from.slice(0, 10);
	const end = to.slice(0, 10);
	for (let guard = 0; guard < 400 && current <= end; guard += 1) {
		result.push(current);
		current = addDays(current, 1).slice(0, 10);
	}
	return result;
}

export function isWeekend(date: string): boolean {
	const day = new Date(`${date.slice(0, 10)}T00:00:00.000Z`).getUTCDay();
	return day === 0 || day === 6;
}

export function nonWorkingDates(
	from: string,
	to: string,
	weekdays: number[] = [0, 6],
	extra: string[] = [],
): string[] {
	const extraSet = new Set(extra.map((value) => value.slice(0, 10)));
	return daysBetween(from, to).filter((date) => {
		const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
		return weekdays.includes(day) || extraSet.has(date);
	});
}

export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds === 0) return "0m";
	const sign = seconds < 0 ? "-" : "";
	const total = Math.round(Math.abs(seconds));
	const days = Math.floor(total / 28_800);
	const hours = Math.floor((total % 28_800) / 3600);
	const minutes = Math.round((total % 3600) / 60);
	const parts = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
	return `${sign}${parts.join(" ")}`;
}

export function formatEstimate(
	value: number,
	statistic: EstimationStatistic,
): string {
	if (statistic === "original_estimate") return formatDuration(value);
	if (statistic === "issue_count") return String(Math.round(value));
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
