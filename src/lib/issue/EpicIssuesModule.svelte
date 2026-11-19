<script lang="ts">
	import type { IssueDetail } from "#lib/api-types.ts";
	import Module from "#lib/components/Module.svelte";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";

	interface Props {
		issue: IssueDetail;
	}

	let { issue }: Props = $props();
</script>

{#if issue.type.name === "Epic"}
	<Module title="Issues in Epic">
		{#if issue.epicIssues.length === 0}
			<p class="empty">No issues in this epic.</p>
		{:else}
			<table class="fat-table table">
				<thead>
					<tr>
						<th>Key</th>
						<th>Summary</th>
						<th>Status</th>
						<th>Assignee</th>
					</tr>
				</thead>
				<tbody>
					{#each issue.epicIssues as child (child.id)}
						<tr>
							<td>
								<a href={`/browse/${child.key}`} class="link">{child.key}</a>
							</td>
							<td>{child.summary}</td>
							<td>
								<StatusLozenge status={child.status} />
							</td>
							<td>{child.assignee?.displayName ?? "Unassigned"}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</Module>
{/if}

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

	.table th:nth-child(1) {
		width: 90px;
	}

	.table th:nth-child(3) {
		width: 130px;
	}

	.table th:nth-child(4) {
		width: 140px;
	}
</style>
