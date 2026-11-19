import type { EstimationField } from "../api-types.ts";

type SprintForDefault = {
	id: string;
	state: "future" | "active" | "closed";
	completeDate: string | null;
	endDate: string | null;
};

export const reportList: {
	id: ReportChart;
	label: string;
	kanban: boolean;
	description: string;
}[] = [
	{
		id: "burndownChart",
		label: "Burndown Chart",
		kanban: false,
		description: "Remaining work over the sprint",
	},
	{
		id: "sprintRetrospective",
		label: "Sprint Report",
		kanban: false,
		description: "Completed, unfinished and removed issues",
	},
	{
		id: "velocityChart",
		label: "Velocity Chart",
		kanban: false,
		description: "Commitment and completed work per sprint",
	},
	{
		id: "cumulativeFlowDiagram",
		label: "Cumulative Flow Diagram",
		kanban: true,
		description: "Issues per column over time",
	},
];

export type ReportChart =
	| "burndownChart"
	| "sprintRetrospective"
	| "velocityChart"
	| "cumulativeFlowDiagram";

export const estimationOptions: { value: EstimationField; label: string }[] = [
	{ value: "story_points", label: "Story points" },
	{ value: "issue_count", label: "Issue count" },
	{ value: "original_estimate", label: "Original time estimate" },
];

export function isReportChart(value: string | undefined): value is ReportChart {
	return reportList.some((report) => report.id === value);
}

export function isEstimationField(
	value: string | undefined,
): value is EstimationField {
	return estimationOptions.some((option) => option.value === value);
}

export function defaultSprintId(
	sprints: SprintForDefault[],
	chart: ReportChart,
): string | undefined {
	if (chart === "sprintRetrospective") {
		return [...sprints]
			.filter((sprint) => sprint.state === "closed")
			.sort((left, right) =>
				(right.completeDate ?? right.endDate ?? "").localeCompare(
					left.completeDate ?? left.endDate ?? "",
				),
			)[0]?.id;
	}
	if (chart === "burndownChart") {
		return (
			sprints.find((sprint) => sprint.state === "active")?.id ??
			[...sprints]
				.filter((sprint) => sprint.state === "closed")
				.sort((left, right) =>
					(right.completeDate ?? right.endDate ?? "").localeCompare(
						left.completeDate ?? left.endDate ?? "",
					),
				)[0]?.id
		);
	}
	return undefined;
}

export function today() {
	return new Date().toISOString().slice(0, 10);
}

export function daysAgo(days: number) {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
}
