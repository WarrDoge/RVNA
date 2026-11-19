<script lang="ts">
	import type { EstimationField, StatusRef } from "#lib/api-types.ts";
	import type { SprintReportRow } from "#lib/shared/agile-reports/sprint-report.ts";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import { formatEstimate } from "#lib/shared/agile-reports/types.ts";

	interface Props {
		title: string;
		rows: SprintReportRow[];
		estimation: EstimationField;
		variant: "completed" | "notCompleted" | "removed";
		sums?: { initial: number; current: number };
	}

	let { title, rows, estimation, variant, sums }: Props = $props();

	let totalInitial = $derived(
		rows.reduce((sum, row) => sum + row.estimateAtStart, 0),
	);
	let totalCurrent = $derived(
		rows.reduce(
			(sum, row) =>
				sum + (variant === "removed" ? row.estimateAtStart : row.estimateAtEnd),
			0,
		),
	);

	function statusForEnd(row: SprintReportRow): StatusRef {
		return {
			id: row.issue.status.id,
			name: row.issue.status.name,
			category: row.statusAtEnd,
		};
	}
</script>

{#snippet issueLink(row: SprintReportRow)}
	<span><a class="issue-key" href={`/browse/${row.issue.key}`}>{row.issue.key}</a>{#if row.addedDuringSprint}<span class="added" title="Added after the sprint started">*</span>{/if}<span class="issue-summary">{row.issue.summary}</span></span>
{/snippet}

<div class="section">
	<div class="section-header">
		<h2>{title}</h2>
		<span class="meta">
			{rows.length} {rows.length === 1 ? "issue" : "issues"}
			{#if sums}
				{" · "}Estimate at start: {formatEstimate(sums.initial, estimation)} ·
				Estimate now: {formatEstimate(sums.current, estimation)}
			{/if}
		</span>
	</div>
	<div class="table-card">
		<table class="fat-table">
			<thead>
				<tr>
					<th class="head">Issue</th>
					<th class="head">Type</th>
					<th class="head">Status</th>
					<th class="head right">Estimate at start</th>
					<th class="head right">
						{variant === "removed" ? "Estimate when removed" : "Estimate now"}
					</th>
				</tr>
			</thead>
			<tbody>
				{#if rows.length === 0}
					<tr>
						<td class="cell empty" colspan={5}>No issues.</td>
					</tr>
				{:else}
					{#each rows as row (row.issue.id)}
						<tr>
							<td class="cell">{@render issueLink(row)}</td>
							<td class="cell">{row.issue.typeName}</td>
							<td class="cell">
								<StatusLozenge status={statusForEnd(row)} />
							</td>
							<td class="cell right">
								{formatEstimate(row.estimateAtStart, estimation)}
							</td>
							<td class="cell right">
								{formatEstimate(
									variant === "removed"
										? row.estimateAtRemoval
										: row.estimateAtEnd,
									estimation,
								)}
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
			<tfoot>
				<tr>
					<td class="cell strong">Total</td>
					<td class="cell"></td>
					<td class="cell"></td>
					<td class="cell right strong">
						{formatEstimate(totalInitial, estimation)}
					</td>
					<td class="cell right strong">
						{formatEstimate(totalCurrent, estimation)}
					</td>
				</tr>
			</tfoot>
		</table>
	</div>
</div>

<style>
	.section {
		margin-top: 20px;
	}

	.section-header {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 8px;
	}

	h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.meta {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 13px;
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

	.right {
		text-align: right;
	}

	.strong {
		font-weight: 600;
	}

	.issue-key {
		color: var(--ds-link, #669df1);
		font-weight: 500;
	}

	.added {
		color: var(--ds-text-subtle, #a9abaf);
		margin-left: 2px;
	}

	.issue-summary {
		color: var(--ds-text-subtle, #a9abaf);
		margin-left: 8px;
	}
</style>
