<script lang="ts">
	import { onMount } from "svelte";
	import { refreshAll } from "$app/navigation";
	import { page } from "$app/state";
	import Banner from "#lib/admin/Banner.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import { absoluteDate, shortDate } from "#lib/dates.ts";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import ProjectFrame from "#lib/project/ProjectFrame.svelte";
	import { rememberProject } from "#lib/recent-projects.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let key = $derived(data.sidebar?.project.key ?? "");
	let total = $derived(data.issues.total);
	let start = $derived(total === 0 ? 0 : data.offset + 1);
	let end = $derived(Math.min(data.offset + data.issues.limit, total));

	$effect(() => {
		rememberProject(page.data.user?.id ?? "", {
			key: data.sidebar.project.key,
			name: data.sidebar.project.name,
			avatarUrl: data.sidebar.project.avatarUrl,
		});
	});

	onMount(() => {
		// SvelteKit ignores a history entry it did not write, such as the one the
		// project-change spec synthesises; router-owned popstates already rerun load.
		function syncFromLocation(event: PopStateEvent) {
			const state = event.state as Record<string, unknown> | null;
			if (state && "sveltekit:metadata" in state) return;
			queueMicrotask(() => {
				const match = /^\/projects\/([^/]+)/.exec(window.location.pathname);
				const key = match ? decodeURIComponent(match[1] ?? "").toUpperCase() : "";
				if (key === data.sidebar.project.key) return;
				void refreshAll();
			});
		}
		window.addEventListener("popstate", syncFromLocation);
		return () => window.removeEventListener("popstate", syncFromLocation);
	});
</script>

<PageTitle title={key ? `${key} issues` : undefined} />

<ProjectFrame data={data.sidebar} active="issues">
		<div class="issues">
			<div class="heading">
				<h1>Issues</h1>
				<span class="muted">{total} {total === 1 ? "issue" : "issues"}</span>
			</div>

			{#if data.archived}
				<Banner tone="warning">
					This project is archived. It is read-only.
				</Banner>
			{/if}

			<table class="fat-table fat-issue-table">
				<thead>
					<tr>
						<th class="col-type" aria-label="Issue type"></th>
						<th class="col-key">Key</th>
						<th class="fat-col-fill">Summary</th>
						<th class="col-person">Assignee</th>
						<th class="col-person">Reporter</th>
						<th class="col-priority" aria-label="Priority"></th>
						<th class="col-status">Status</th>
						<th class="col-status">Resolution</th>
						<th class="col-date">Created</th>
						<th class="col-date">Updated</th>
					</tr>
				</thead>
				<tbody>
					{#each data.issues.issues as issue (issue.id)}
						<tr>
							<td>
								<IssueTypeIcon
									id={issue.type.id}
									name={issue.type.name}
									icon={issue.type.iconUrl}
								/>
							</td>
							<td>
								<a class="key-link" href={`/browse/${issue.key}`}>{issue.key}</a>
							</td>
							<td class="fat-col-fill">
								<a
									class="summary-link"
									href={`/browse/${issue.key}`}
									title={issue.summary}
								>
									{issue.summary}
								</a>
							</td>
							<td>{issue.assignee?.displayName ?? "Unassigned"}</td>
							<td>{issue.reporter?.displayName ?? "—"}</td>
							<td>
								{#if issue.priority}
									<span title={issue.priority.name}>
										<PriorityIcon
											id={issue.priority.id}
											iconUrl={issue.priority.iconUrl}
											name={issue.priority.name}
										/>
									</span>
								{/if}
							</td>
							<td>
								<StatusLozenge status={issue.status} />
							</td>
							<td>{issue.resolution?.name ?? "Unresolved"}</td>
							<td title={absoluteDate(issue.created)}>{shortDate(issue.created)}</td>
							<td title={absoluteDate(issue.updated)}>{shortDate(issue.updated)}</td>
						</tr>
					{:else}
						<tr>
							<td colspan="10" class="muted">No issues in this project.</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="pager">
				<span class="muted">{start}–{end} of {total}</span>
				<form method="GET" class="pager-buttons">
					<button
						type="submit"
						name="offset"
						value={Math.max(0, data.offset - data.issues.limit)}
						class="pager-button"
						class:disabled={data.offset === 0}
						disabled={data.offset === 0}
					>
						Previous
					</button>
					<button
						type="submit"
						name="offset"
						value={data.offset + data.issues.limit}
						class="pager-button"
						class:disabled={end >= total}
						disabled={end >= total}
					>
						Next
					</button>
				</form>
			</div>
		</div>
	</ProjectFrame>

<style>
	.issues {
		flex: 1;
		min-width: 0;
		padding: 24px 32px;
		overflow-x: auto;
	}

	.heading {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 16px;
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	.muted {
		color: var(--ds-text-subtle);
	}

	.fat-table {
		width: 100%;
	}

	.col-type {
		width: 24px;
	}

	.col-key {
		width: 80px;
	}

	.col-person {
		width: 130px;
	}

	.col-priority {
		width: 24px;
	}

	.col-status {
		width: 120px;
	}

	.col-date {
		width: 150px;
	}

	.key-link {
		color: var(--ds-link);
		font-weight: 500;
	}

	.summary-link {
		color: var(--ds-text);
		text-decoration: none;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
	}

	.pager-buttons {
		margin: 0 0 0 auto;
		display: flex;
		gap: 8px;
	}

	.pager-button {
		height: 28px;
		padding: 0 10px;
		background-color: var(--ds-background-neutral);
		color: var(--ds-text);
		border: 0;
		border-radius: 3px;
		cursor: pointer;
		font-size: 13px;
	}

	.pager-button.disabled {
		opacity: 0.5;
	}

</style>
