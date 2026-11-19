<script lang="ts">
import { token } from "#lib/tokens.ts";
import BurndownChart from "#lib/charts/BurndownChart.svelte";
import CumulativeFlowChart from "#lib/charts/CumulativeFlowChart.svelte";
import VelocityChart from "#lib/charts/VelocityChart.svelte";
import type { BurndownResult } from "#lib/shared/agile-reports/burndown.ts";
import type { EstimationStatistic } from "#lib/shared/agile-reports/types.ts";
import type { VelocitySprint } from "#lib/shared/agile-reports/velocity.ts";

const estimation: EstimationStatistic = "story_points";
const burndownStart = "2026-02-02T09:00:00.000Z";
const burndownEnd = "2026-02-13T17:00:00.000Z";

const burndown: BurndownResult = {
	points: [
		{ at: "2026-02-02T09:00:00.000Z", remaining: 34 },
		{ at: "2026-02-04T12:00:00.000Z", remaining: 30 },
		{ at: "2026-02-06T16:00:00.000Z", remaining: 23 },
		{ at: "2026-02-10T11:00:00.000Z", remaining: 18 },
		{ at: "2026-02-12T15:00:00.000Z", remaining: 9 },
		{ at: "2026-02-13T17:00:00.000Z", remaining: 3 },
	],
	guideline: [
		{ at: "2026-02-02T09:00:00.000Z", remaining: 34 },
		{ at: "2026-02-03T09:00:00.000Z", remaining: 30.22 },
		{ at: "2026-02-04T09:00:00.000Z", remaining: 26.44 },
		{ at: "2026-02-05T09:00:00.000Z", remaining: 22.67 },
		{ at: "2026-02-06T09:00:00.000Z", remaining: 18.89 },
		{ at: "2026-02-09T09:00:00.000Z", remaining: 15.11 },
		{ at: "2026-02-10T09:00:00.000Z", remaining: 11.33 },
		{ at: "2026-02-11T09:00:00.000Z", remaining: 7.56 },
		{ at: "2026-02-12T09:00:00.000Z", remaining: 3.78 },
		{ at: "2026-02-13T09:00:00.000Z", remaining: 0 },
	],
	eventRows: [
		{
			at: "2026-02-04T12:00:00.000Z",
			issueKey: "SAMPLE-14",
			issueSummary: "Finish the settlement flow",
			eventType: "completed",
			increase: 0,
			decrease: 4,
			remaining: 30,
		},
		{
			at: "2026-02-06T16:00:00.000Z",
			issueKey: "SAMPLE-21",
			issueSummary: "Trim the retry scope",
			eventType: "estimate-changed",
			increase: 0,
			decrease: 7,
			remaining: 23,
		},
		{
			at: "2026-02-10T11:00:00.000Z",
			issueKey: "SAMPLE-8",
			issueSummary: "Wire the refund endpoint",
			eventType: "completed",
			increase: 0,
			decrease: 5,
			remaining: 18,
		},
		{
			at: "2026-02-12T15:00:00.000Z",
			issueKey: "SAMPLE-17",
			issueSummary: "Polish the receipt email",
			eventType: "completed",
			increase: 0,
			decrease: 9,
			remaining: 9,
		},
		{
			at: "2026-02-13T17:00:00.000Z",
			issueKey: "SAMPLE-3",
			issueSummary: "Ship the audit trail",
			eventType: "completed",
			increase: 0,
			decrease: 6,
			remaining: 3,
		},
	],
	nonWorkingDays: ["2026-02-07", "2026-02-08"],
	initialScope: 34,
	remainingAtEnd: 3,
	totalIncrease: 0,
	totalDecrease: 31,
};

const velocitySprints: VelocitySprint[] = [
	{
		id: "sample-sprint-1",
		name: "Payments overhaul",
		startDate: "2026-01-05T09:00:00.000Z",
		endDate: "2026-01-16T18:00:00.000Z",
		completeDate: "2026-01-16T19:00:00.000Z",
		commitment: 34,
		completed: 29,
	},
	{
		id: "sample-sprint-2",
		name: "Search beta",
		startDate: "2026-01-19T09:00:00.000Z",
		endDate: "2026-01-30T18:00:00.000Z",
		completeDate: "2026-01-30T19:00:00.000Z",
		commitment: 30,
		completed: 32,
	},
	{
		id: "sample-sprint-3",
		name: "Onboarding",
		startDate: "2026-02-02T09:00:00.000Z",
		endDate: "2026-02-13T18:00:00.000Z",
		completeDate: "2026-02-13T19:00:00.000Z",
		commitment: 28,
		completed: 28,
	},
	{
		id: "sample-sprint-4",
		name: "Reporting",
		startDate: "2026-02-16T09:00:00.000Z",
		endDate: "2026-02-27T18:00:00.000Z",
		completeDate: "2026-02-27T19:00:00.000Z",
		commitment: 36,
		completed: 31,
	},
	{
		id: "sample-sprint-5",
		name: "Platform",
		startDate: "2026-03-02T09:00:00.000Z",
		endDate: "2026-03-13T18:00:00.000Z",
		completeDate: "2026-03-13T19:00:00.000Z",
		commitment: 32,
		completed: 35,
	},
];
const averageCompleted = 31;
const averageCommitment = 32;

const cfd = {
	board: {
		rapidViewId: 990001,
		name: "Sample board",
		type: "scrum",
		estimationField: "story_points",
	},
	from: "2026-03-02",
	to: "2026-03-11",
	columns: [
		{ id: "todo", name: "To Do", sequence: 0, statusIds: ["todo-status"] },
		{
			id: "progress",
			name: "In Progress",
			sequence: 1,
			statusIds: ["progress-status"],
		},
		{
			id: "review",
			name: "In Review",
			sequence: 2,
			statusIds: ["review-status"],
		},
		{ id: "done", name: "Done", sequence: 3, statusIds: ["done-status"] },
	],
	assignees: [],
	dates: [
		"2026-03-02",
		"2026-03-03",
		"2026-03-04",
		"2026-03-05",
		"2026-03-06",
		"2026-03-07",
		"2026-03-08",
		"2026-03-09",
		"2026-03-10",
		"2026-03-11",
	],
	series: [
		{
			columnId: "todo",
			name: "To Do",
			values: [18, 17, 16, 15, 14, 12, 10, 9, 8, 7],
		},
		{
			columnId: "progress",
			name: "In Progress",
			values: [6, 7, 8, 7, 8, 9, 10, 9, 8, 7],
		},
		{
			columnId: "review",
			name: "In Review",
			values: [3, 3, 4, 5, 4, 4, 3, 3, 4, 4],
		},
		{
			columnId: "done",
			name: "Done",
			values: [2, 4, 5, 7, 9, 10, 12, 14, 15, 17],
		},
	],
	total: [29, 31, 33, 34, 35, 35, 35, 35, 35, 35],
};
const visibleColumns = new Set(["todo", "progress", "review", "done"]);

const cardStyle =
	"width: 1000px; padding: 16px; background-color: " +
	token("elevation.surface.raised") +
	"; border: 1px solid " +
	token("color.border") +
	"; border-radius: 3px;";
</script>

<svelte:head>
	<title>Charts - RVNA</title>
</svelte:head>

<main
	style="min-height: 100vh; padding: 24px; background-color: {token(
		'elevation.surface',
	)}; color: {token('color.text')};"
>
	<h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 500; line-height: 32px;">
		Charts
	</h1>
	<p style="margin: 0 0 24px; color: {token('color.text.subtle')};">
		Temporary gallery for the Svelte chart components. The numbers are invented.
	</p>

	<section style="margin-bottom: 32px;">
		<h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 500;">
			Burndown chart
		</h2>
		<div data-testid="chart-burndown" style={cardStyle}>
			<BurndownChart
				data={burndown}
				start={burndownStart}
				end={burndownEnd}
				{estimation}
			/>
		</div>
	</section>

	<section style="margin-bottom: 32px;">
		<h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 500;">
			Velocity chart
		</h2>
		<div data-testid="chart-velocity" style={cardStyle}>
			<VelocityChart
				sprints={velocitySprints}
				{averageCompleted}
				{averageCommitment}
				{estimation}
			/>
		</div>
	</section>

	<section style="margin-bottom: 32px;">
		<h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 500;">
			Cumulative flow diagram
		</h2>
		<div data-testid="chart-cumulative-flow" style={cardStyle}>
			<CumulativeFlowChart data={cfd} visibleColumnIds={visibleColumns} />
		</div>
	</section>
</main>
