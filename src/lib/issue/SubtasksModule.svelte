<script lang="ts">
	import type { IssueDetail } from "#lib/api-types.ts";
	import Module from "#lib/components/Module.svelte";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import ProgressBar from "./ProgressBar.svelte";

	interface Props {
		issue: IssueDetail;
		canCreate: boolean;
		onCreateSubtask: () => void;
	}

	let { issue, canCreate, onCreateSubtask }: Props = $props();
</script>

{#snippet actions()}
	<button type="button" class="link-button" onclick={onCreateSubtask}>
		Create sub-task
	</button>
{/snippet}

<Module
	title="Sub-Tasks"
	actions={canCreate && !issue.type.subtask ? actions : undefined}
>
	{#if issue.subtasks.length === 0}
		<p class="empty">No sub-tasks.</p>
	{:else}
		<table class="fat-table table">
			<thead>
				<tr>
					<th>Key</th>
					<th>Summary</th>
					<th>Status</th>
					<th>Assignee</th>
					<th>Progress</th>
				</tr>
			</thead>
			<tbody>
				{#each issue.subtasks as subtask (subtask.id)}
					<tr>
						<td>
							<a href={`/browse/${subtask.key}`} class="link">{subtask.key}</a>
						</td>
						<td>{subtask.summary}</td>
						<td>
							<StatusLozenge status={subtask.status} />
						</td>
						<td>{subtask.assignee?.displayName ?? "Unassigned"}</td>
						<td>
							<ProgressBar category={subtask.status.category} />
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</Module>

<style>
	.empty {
		margin: 0;
		color: var(--ds-text-subtle, #596773);
	}

	.link {
		color: var(--ds-link, #0c66e4);
		text-decoration: none;
	}

	.table {
		width: 100%;
	}

	.table th:nth-child(1),
	.table th:nth-child(5) {
		width: 90px;
	}

	.table th:nth-child(3) {
		width: 130px;
	}

	.table th:nth-child(4) {
		width: 140px;
	}

	.link-button {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link, #0c66e4);
		text-decoration: none;
		cursor: pointer;
		font-size: inherit;
	}
</style>
