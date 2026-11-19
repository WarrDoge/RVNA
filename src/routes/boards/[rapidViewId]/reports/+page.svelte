<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import type { EstimationField } from "#lib/api-types.ts";
	import BoardShell from "#lib/boards/BoardShell.svelte";
	import MissingBoard from "#lib/boards/MissingBoard.svelte";
	import {
		reportList,
		type ReportChart,
	} from "#lib/boards/reports.ts";
	import BurndownChart from "#lib/charts/BurndownChart.svelte";
	import VelocityChart from "#lib/charts/VelocityChart.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import { absoluteDate } from "#lib/dates.ts";
	import { formatEstimate } from "#lib/shared/agile-reports/types.ts";
	import BurndownEventTable from "./BurndownEventTable.svelte";
	import CumulativeFlowSection from "./CumulativeFlowSection.svelte";
	import EstimationSelect from "./EstimationSelect.svelte";
	import ReportHeader from "./ReportHeader.svelte";
	import ReportSprintSelect from "./ReportSprintSelect.svelte";
	import ReportTable from "./ReportTable.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let reports = $derived(
		reportList.filter(
			(report) => data.board?.type === "scrum" || report.kanban,
		),
	);

	function hrefFor(patch: {
		chart?: ReportChart;
		sprint?: string | undefined;
		estimation?: EstimationField;
	}) {
		const params = new URLSearchParams(page.url.searchParams.toString());
		const onBoardAddress = page.url.pathname === "/secure/RapidBoard.jspa";
		if (onBoardAddress) {
			params.set("rapidView", String(data.board?.rapidViewId ?? ""));
			params.set("view", "reporting");
		} else {
			params.delete("rapidView");
			params.delete("view");
		}
		if (patch.chart !== undefined) {
			params.set("chart", patch.chart);
			params.delete("sprint");
		} else if (patch.sprint !== undefined) {
			if (patch.sprint) params.set("sprint", patch.sprint);
			else params.delete("sprint");
		}
		if (patch.estimation !== undefined) {
			params.set("estimation", patch.estimation);
		}
		const path = onBoardAddress
			? "/secure/RapidBoard.jspa"
			: `/boards/${data.board?.rapidViewId}/reports`;
		return `${path}?${params.toString()}`;
	}

	function update(patch: {
		chart?: ReportChart;
		sprint?: string | undefined;
		estimation?: EstimationField;
	}) {
		void goto(hrefFor(patch), {
			replace: true,
			reset: false,
		});
	}
</script>

{#if data.missing || !data.board || !data.sidebar}
	<MissingBoard />
{:else}
	<BoardShell board={data.board} sidebar={data.sidebar} active="reports">
		<div class="reports">
			<aside class="report-nav">
				<div class="nav-title">Reports</div>
				{#each reports as report (report.id)}
					<a
						class:active={report.id === data.chart}
						href={hrefFor({ chart: report.id })}
					>
						<div>{report.label}</div>
						<div class="description">{report.description}</div>
					</a>
				{/each}
			</aside>
			<main class="panel">
				{#if data.sprints.length === 0 && (data.chart === "burndownChart" || data.chart === "sprintRetrospective")}
					<p class="muted">
						This board has no sprints yet. Create a sprint from the backlog
						first.
					</p>
				{/if}

				{#if data.chart === "burndownChart" && data.sprints.length > 0}
					<ReportHeader boardName={data.board.name} title="Burndown Chart">
						<ReportSprintSelect
							sprints={data.sprints}
							value={data.selectedSprintId ?? undefined}
							onChange={(sprint) => update({ sprint })}
						/>
						<EstimationSelect
							value={data.estimation}
							onChange={(estimation) => update({ estimation })}
						/>
					</ReportHeader>
					{#if data.reportError}
						<p class="alert" role="alert">{data.reportError}</p>
					{/if}
					{#if data.burndown}
						{@const burndown = data.burndown}
						{@const start =
							burndown.sprint.startDate ?? burndown.points[0]?.at}
						{@const end =
							burndown.sprint.completeDate ??
							burndown.sprint.endDate ??
							burndown.points.at(-1)?.at}
						{#if start && end}
							<div class="chart-card">
								<BurndownChart
									data={burndown}
									{start}
									{end}
									estimation={burndown.estimation}
								/>
							</div>
						{/if}
						<div class="stats">
							<span>
								Scope:{" "}
								<strong>
									{formatEstimate(
										burndown.initialScope,
										burndown.estimation,
									)}
								</strong>
							</span>
							<span>
								Remaining:{" "}
								<strong>
									{formatEstimate(
										burndown.remainingAtEnd,
										burndown.estimation,
									)}
								</strong>
							</span>
							<span>
								Added: {formatEstimate(
									burndown.totalIncrease,
									burndown.estimation,
								)}
							</span>
							<span>
								Completed: {formatEstimate(
									burndown.totalDecrease,
									burndown.estimation,
								)}
							</span>
						</div>
						<BurndownEventTable
							events={burndown.eventRows}
							estimation={burndown.estimation}
						/>
					{/if}
				{/if}

				{#if data.chart === "sprintRetrospective" && data.sprints.length > 0}
					<ReportHeader boardName={data.board.name} title="Sprint Report">
						<ReportSprintSelect
							sprints={data.sprints}
							value={data.selectedSprintId ?? undefined}
							onChange={(sprint) => update({ sprint })}
						/>
						<EstimationSelect
							value={data.estimation}
							onChange={(estimation) => update({ estimation })}
						/>
					</ReportHeader>
					{#if data.reportError}
						<p class="alert" role="alert">{data.reportError}</p>
					{/if}
					{#if data.sprintReport}
						{@const report = data.sprintReport}
						{@const start =
							report.sprint.startDate ?? report.burndown.points[0]?.at}
						{@const end =
							report.sprint.completeDate ??
							report.sprint.endDate ??
							report.burndown.points.at(-1)?.at}
						<div class="sprint-meta">
							<strong>{report.sprint.name}</strong>
							<Lozenge
								appearance={report.sprint.state === "closed"
									? "default"
									: "success"}
							>
								{report.sprint.state}
							</Lozenge>
							{#if report.sprint.startDate && report.sprint.endDate}
								<span class="muted">
									{absoluteDate(report.sprint.startDate)} –{" "}
									{absoluteDate(report.sprint.endDate)}
								</span>
							{/if}
							{#if report.addedDuringSprint.length > 0}
								<span class="muted">* added after sprint start</span>
							{/if}
						</div>
						{#if start && end}
							<div class="chart-card">
								<BurndownChart
									data={report.burndown}
									{start}
									{end}
									estimation={report.estimation}
								/>
							</div>
						{/if}
						<ReportTable
							title="Completed issues"
							rows={report.completed}
							estimation={report.estimation}
							variant="completed"
							sums={{
								initial: report.sums.completedInitial,
								current: report.sums.completedCurrent,
							}}
						/>
						<ReportTable
							title="Issues not completed"
							rows={report.notCompleted}
							estimation={report.estimation}
							variant="notCompleted"
							sums={{
								initial: report.sums.notCompletedInitial,
								current: report.sums.notCompletedCurrent,
							}}
						/>
						<ReportTable
							title="Issues removed from sprint"
							rows={report.removed}
							estimation={report.estimation}
							variant="removed"
							sums={{
								initial: report.sums.removedInitial,
								current: report.sums.removedCurrent,
							}}
						/>
						<div class="totals">
							<span>
								Total estimate at start:{" "}
								{formatEstimate(report.sums.totalInitial, report.estimation)}
							</span>
							<span>
								Total estimate at end:{" "}
								{formatEstimate(report.sums.totalCurrent, report.estimation)}
							</span>
						</div>
					{/if}
				{/if}

				{#if data.chart === "velocityChart"}
					<ReportHeader boardName={data.board.name} title="Velocity Chart">
						<EstimationSelect
							value={data.estimation}
							onChange={(estimation) => update({ estimation })}
						/>
					</ReportHeader>
					{#if data.reportError}
						<p class="alert" role="alert">{data.reportError}</p>
					{/if}
					{#if data.velocity}
						{@const velocity = data.velocity}
						<div class="chart-card">
							<VelocityChart
								sprints={velocity.sprints}
								averageCompleted={velocity.averageCompleted}
								averageCommitment={velocity.averageCommitment}
								estimation={velocity.estimation}
							/>
						</div>
						<p class="average">
							Average completed:{" "}
							<strong>
								{formatEstimate(
									velocity.averageCompleted,
									velocity.estimation,
								)}
							</strong>
							over {velocity.sprints.length} closed
							{velocity.sprints.length === 1 ? "sprint" : "sprints"}.
						</p>
						<div class="table-card">
							<table class="fat-table">
								<thead>
									<tr>
										<th class="head">Sprint</th>
										<th class="head">Dates</th>
										<th class="head right">Commitment</th>
										<th class="head right">Completed</th>
									</tr>
								</thead>
								<tbody>
									{#if velocity.sprints.length === 0}
										<tr>
											<td class="cell empty" colspan={4}>
												No closed sprints yet.
											</td>
										</tr>
									{:else}
										{#each velocity.sprints as sprint (sprint.id)}
											<tr>
												<td class="cell">{sprint.name}</td>
												<td class="cell subtle">
													{sprint.startDate
														? absoluteDate(sprint.startDate)
														: "?"}
													– {sprint.endDate
														? absoluteDate(sprint.endDate)
														: "?"}
												</td>
												<td class="cell right">
													{formatEstimate(
														sprint.commitment,
														velocity.estimation,
													)}
												</td>
												<td class="cell right">
													{formatEstimate(
														sprint.completed,
														velocity.estimation,
													)}
												</td>
											</tr>
										{/each}
									{/if}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}

				{#if data.chart === "cumulativeFlowDiagram"}
					<CumulativeFlowSection
						boardName={data.board.name}
						initial={data.flow}
						initialError={data.reportError}
					/>
				{/if}
			</main>
		</div>
	</BoardShell>
{/if}

<style>
	.reports {
		display: flex;
		flex: 1;
		min-width: 0;
	}

	.report-nav {
		width: 220px;
		min-width: 220px;
		padding: 16px 8px;
		border-right: 1px solid var(--ds-border, #3b3d42);
		background-color: var(--ds-surface-sunken, #161a1d);
	}

	.nav-title {
		padding: 0 8px 8px;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.report-nav a {
		display: block;
		text-decoration: none;
		width: 100%;
		padding: 8px 10px;
		margin-bottom: 2px;
		text-align: left;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle, #a9abaf);
		cursor: pointer;
		font-size: 14px;
		font-weight: 400;
	}

	.report-nav a.active {
		background: var(--ds-background-selected, #1c2b41);
		color: var(--ds-text-selected, #669df1);
		font-weight: 600;
	}

	.description {
		font-size: 11px;
		opacity: 0.8;
	}

	.panel {
		flex: 1;
		min-width: 0;
		padding: 20px 24px 40px;
		overflow: auto;
	}

	.chart-card {
		padding: 12px 8px 4px;
		background-color: var(--ds-surface-raised, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
	}

	.stats {
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
		margin-top: 12px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 13px;
	}

	.stats strong {
		color: var(--ds-text, #cecfd2);
	}

	.muted {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.alert {
		color: var(--ds-text-danger, #fd9891);
	}

	.sprint-meta {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 12px;
	}

	.sprint-meta strong {
		font-size: 16px;
	}

	.totals {
		margin-top: 16px;
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 13px;
	}

	.average {
		color: var(--ds-text-subtle, #a9abaf);
		margin-top: 12px;
	}

	.average strong {
		color: var(--ds-text, #cecfd2);
	}

	.table-card {
		padding: 0;
		overflow-x: auto;
		background-color: var(--ds-surface-raised, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
	}

	table {
		width: 100%;
	}

	.head {
		padding: 8px 12px;
		text-align: left;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle, #a9abaf);
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		white-space: nowrap;
	}

	.cell {
		padding: 8px 12px;
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		color: var(--ds-text, #cecfd2);
		vertical-align: middle;
	}

	.empty {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.subtle {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.right {
		text-align: right;
	}
</style>
