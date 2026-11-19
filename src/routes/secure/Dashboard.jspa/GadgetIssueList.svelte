<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import {
		absoluteDate,
		formatDateOnly,
		formatDuration,
		relativeDate,
	} from "#lib/dates.ts";
	import { systemField } from "#lib/shared/fields.ts";
	import type { GadgetData, GadgetIssue } from "#lib/dashboards/types.ts";

	interface Props {
		list: NonNullable<GadgetData["issueList"]>;
		columns: string[];
		onStartAt: (startAt: number) => void;
	}

	let { list, columns, onStartAt }: Props = $props();

	function narrow(column: string) {
		return column === "type" || column === "priority";
	}

	const minWidth = $derived(
		columns.reduce(
			(sum, column) =>
				sum + (column === "summary" ? 160 : narrow(column) ? 28 : 90),
			0,
		),
	);
	const first = $derived(list.startAt + 1);
	const last = $derived(list.startAt + list.issues.length);
	const pageSize = $derived(list.maxResults);

	function columnLabel(column: string) {
		const field = systemField(column);
		if (field) return field.header ?? field.name;
		return column.replace(/^customfield_/, "");
	}

	function statusAppearance(category: string) {
		return category === "done"
			? ("success" as const)
			: category === "indeterminate"
				? ("inprogress" as const)
				: ("default" as const);
	}
</script>

{#snippet cell(issue: GadgetIssue, column: string)}
	{#if column === "type"}
		<IssueTypeIcon name={issue.type.name} size={14} />
	{:else if column === "key"}
		<a href={`/browse/${issue.key}`} class="link">{issue.key}</a>
	{:else if column === "summary"}
		{issue.summary}
	{:else if column === "priority"}
		{#if issue.priority}
			<PriorityIcon name={issue.priority.name} />
		{/if}
	{:else if column === "status"}
		<span class="fat-lozenge">
			<Lozenge appearance={statusAppearance(issue.status.category)}
				>{issue.status.name}</Lozenge
			>
		</span>
	{:else if column === "assignee"}
		{issue.assignee?.displayName ?? ""}
	{:else if column === "reporter"}
		{issue.reporter?.displayName ?? ""}
	{:else if column === "resolution"}
		{issue.resolution?.name ?? ""}
	{:else if column === "created"}
		{issue.created ? absoluteDate(issue.created) : ""}
	{:else if column === "updated"}
		{issue.updated ? relativeDate(issue.updated) : ""}
	{:else if column === "resolved"}
		{issue.resolved ? absoluteDate(issue.resolved) : ""}
	{:else if column === "dueDate"}
		{issue.dueDate ? formatDateOnly(issue.dueDate) : ""}
	{:else if column === "project"}
		{issue.project.name}
	{:else if column === "labels"}
		{issue.labels.join(", ")}
	{:else if column === "components"}
		{issue.components.join(", ")}
	{:else if column === "fixVersions"}
		{issue.fixVersions.join(", ")}
	{:else if column === "affectsVersions"}
		{issue.affectsVersions.join(", ")}
	{:else if column === "sprint"}
		{issue.sprint ?? ""}
	{:else if column === "epic"}
		{issue.epic?.key ?? ""}
	{:else if column === "parent"}
		{issue.parent?.key ?? ""}
	{:else if column === "creator"}
		{issue.creator?.displayName ?? ""}
	{:else if column === "storyPoints"}
		{issue.storyPoints ?? ""}
	{:else if column === "timeSpent"}
		{issue.timeSpent === null ? "" : formatDuration(issue.timeSpent)}
	{:else if column === "originalEstimate"}
		{issue.originalEstimate === null
			? ""
			: formatDuration(issue.originalEstimate)}
	{:else if column === "remainingEstimate"}
		{issue.remainingEstimate === null
			? ""
			: formatDuration(issue.remainingEstimate)}
	{/if}
{/snippet}

{#if list.total === 0}
	<p class="muted">No issues.</p>
{:else}
	<div class="scroll">
		<table
			class="fat-table issues"
			style="min-width: {minWidth}px; table-layout: fixed; border-collapse: collapse;"
		>
			<thead>
				<tr>
					{#each columns as column (column)}
						<th
							style="width: {column === 'summary'
								? 'auto'
								: narrow(column)
									? '28px'
									: '90px'};"
						>
							{columnLabel(column)}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each list.issues as issue (issue.id)}
					<tr>
						{#each columns as column (column)}
							<td class:summary={column === "summary"}>
								{@render cell(issue, column)}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
		{#if list.total > pageSize}
			<div class="pager">
				<span>{first}–{last} of {list.total}</span>
				<span class="buttons">
					<button
						type="button"
						aria-label="Previous page"
						disabled={list.startAt === 0}
						onclick={() => onStartAt(Math.max(0, list.startAt - pageSize))}
						style="color: {list.startAt === 0
							? token('color.text.disabled')
							: token('color.text.subtle')}; cursor: {list.startAt === 0
							? 'default'
							: 'pointer'};"
					>
						‹
					</button>
					<button
						type="button"
						aria-label="Next page"
						disabled={last >= list.total}
						onclick={() => onStartAt(list.startAt + pageSize)}
						style="color: {last >= list.total
							? token('color.text.disabled')
							: token('color.text.subtle')}; cursor: {last >= list.total
							? 'default'
							: 'pointer'};"
					>
						›
					</button>
				</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.muted {
		margin: 0;
		color: var(--ds-text-subtle);
	}
	.scroll {
		overflow-x: auto;
	}
	.issues {
		width: 100%;
	}
	th {
		text-align: left;
		font-weight: 600;
		font-size: 11px;
		padding: 4px 6px;
		color: var(--ds-text-subtle);
	}
	td {
		padding: 4px 6px;
		font-size: 13px;
		vertical-align: top;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	td.summary {
		white-space: normal;
	}
	.link {
		color: var(--ds-link);
		text-decoration: none;
	}
	.pager {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}
	.buttons {
		margin-left: auto;
		display: flex;
		gap: 4px;
	}
	.buttons button {
		width: 22px;
		height: 22px;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		background: transparent;
	}
</style>
