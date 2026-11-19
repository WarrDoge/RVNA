export const queuePageSize = 50;

/** The offset of the last page when `startAt` is past the end of the queue, else `startAt`. */
export function clampStartAt(startAt: number, total: number) {
	if (startAt < total) return startAt;
	return Math.max(0, Math.floor((total - 1) / queuePageSize) * queuePageSize);
}

export type QueueCellKind =
	| "key"
	| "summary"
	| "type"
	| "status"
	| "priority"
	| "user"
	| "text"
	| "date"
	| "components"
	| "sla";

export type SlaState = "ongoing" | "paused" | "completed" | "breached";

export type QueueCell = {
	kind: QueueCellKind;
	text: string | null;
	href: string | null;
	category: string | null;
	iconColor: string | null;
	state: SlaState | null;
	remainingMinutes: number | null;
	breached: boolean | null;
	names: string[];
};

export type QueueColumn = {
	id: string;
	label: string;
	kind: QueueCellKind;
};

export type QueueIssueRow = {
	key: string;
	summary: string;
	cells: Record<string, QueueCell>;
};

export type QueuePage = {
	queue: { id: string; name: string; jql: string };
	columns: QueueColumn[];
	startAt: number;
	maxResults: number;
	total: number;
	issues: QueueIssueRow[];
};

export function emptyCell(kind: QueueCellKind): QueueCell {
	return {
		kind,
		text: null,
		href: null,
		category: null,
		iconColor: null,
		state: null,
		remainingMinutes: null,
		breached: null,
		names: [],
	};
}

/** Formats a minute count the way a Jira SLA column does: 2h 15m, 1m, -3h. */
export function formatSlaMinutes(minutes: number | null): string {
	if (minutes === null) return "—";
	const negative = minutes < 0;
	const total = Math.abs(minutes);
	const days = Math.floor(total / (60 * 24));
	const hours = Math.floor((total % (60 * 24)) / 60);
	const mins = total % 60;
	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (days === 0 && (mins > 0 || parts.length === 0)) parts.push(`${mins}m`);
	return `${negative ? "-" : ""}${parts.join(" ")}`;
}
