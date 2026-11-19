import { daysBetween } from "./types.ts";

export type CfdColumn = {
	id: string;
	name: string;
	sequence: number;
	statusIds: string[];
};

export type CfdStatusChange = {
	at: string;
	fromStatusId: string | null;
	toStatusId: string;
};

export type CfdIssue = {
	id: string;
	key: string;
	created: string | null;
	statusId: string;
	statusChanges: CfdStatusChange[];
};

export type CumulativeFlowInput = {
	from: string;
	to: string;
	columns: CfdColumn[];
	issues: CfdIssue[];
};

export type CumulativeFlowResult = {
	dates: string[];
	series: { columnId: string; name: string; values: number[] }[];
	total: number[];
};

function statusAtStart(issue: CfdIssue, from: string): string {
	const changes = [...issue.statusChanges].sort((left, right) =>
		left.at.localeCompare(right.at),
	);
	let status =
		changes[0]?.fromStatusId ?? changes[0]?.toStatusId ?? issue.statusId;
	for (const change of changes) {
		if (change.at > from) break;
		status = change.toStatusId;
	}
	return status;
}

export function buildCumulativeFlow(
	input: CumulativeFlowInput,
): CumulativeFlowResult {
	const dates = daysBetween(input.from, input.to);
	const columns = [...input.columns].sort(
		(left, right) => left.sequence - right.sequence,
	);
	const statusToColumn = new Map<string, string>();
	for (const column of columns) {
		for (const statusId of column.statusIds) {
			statusToColumn.set(statusId, column.id);
		}
	}
	const series = columns.map((column) => ({
		columnId: column.id,
		name: column.name,
		values: dates.map(() => 0),
	}));
	const total = dates.map(() => 0);
	const fromTime = new Date(
		`${input.from.slice(0, 10)}T00:00:00.000Z`,
	).getTime();

	for (const issue of input.issues) {
		const createdTime = issue.created
			? new Date(issue.created).getTime()
			: Number.NEGATIVE_INFINITY;
		const changes = [...issue.statusChanges].sort((left, right) =>
			left.at.localeCompare(right.at),
		);
		let status = statusAtStart(issue, input.from);
		let changeIndex = 0;
		for (const [index, date] of dates.entries()) {
			const dayEnd = new Date(`${date}T23:59:59.999Z`).getTime();
			while (
				changeIndex < changes.length &&
				new Date(changes[changeIndex].at).getTime() <= dayEnd
			) {
				status = changes[changeIndex].toStatusId;
				changeIndex += 1;
			}
			if (createdTime > dayEnd || dayEnd < fromTime) continue;
			const columnId = statusToColumn.get(status);
			if (!columnId) continue;
			const seriesRow = series.find((row) => row.columnId === columnId);
			if (seriesRow) seriesRow.values[index] += 1;
			total[index] += 1;
		}
	}

	return { dates, series, total };
}
