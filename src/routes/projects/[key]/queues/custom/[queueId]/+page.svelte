<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { navigating, page } from "$app/state";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import ProjectFrame from "#lib/project/ProjectFrame.svelte";
	import { rememberProject } from "#lib/recent-projects.ts";
	import Cell from "../../Cell.svelte";
	import { emptyCell, queuePageSize } from "../../queue.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let loading = $derived(navigating.to?.route.id === page.route.id);
	let queueName = $derived(
		loading ? "Queue" : (data.page?.queue.name ?? "Queue"),
	);
	let total = $derived(loading ? 0 : (data.page?.total ?? 0));
	let columns = $derived(loading ? [] : (data.page?.columns ?? []));
	let offset = $derived(loading ? 0 : (data.page?.startAt ?? data.startAt));
	let start = $derived(total === 0 ? 0 : offset + 1);
	let end = $derived(Math.min(offset + queuePageSize, total));
	let columnCount = $derived(columns.length || 1);

	$effect(() => {
		const key = data.sidebar?.project.key;
		const name = data.sidebar?.project.name;
		const avatarUrl = data.sidebar?.project.avatarUrl ?? null;
		if (!key || !name) return;
		rememberProject(page.data.user?.id ?? "", { key, name, avatarUrl });
	});

	// The queue changes while an agent is elsewhere: refresh when the tab comes back, at most
	// every 10 seconds.
	$effect(() => {
		let last = Date.now();
		function refresh() {
			if (document.visibilityState !== "visible") return;
			if (Date.now() - last < 10_000) return;
			last = Date.now();
			void invalidate("app:queues");
		}
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	});

	function pageHref(next: number) {
		const url = new URL(page.url.href);
		if (next <= 0) url.searchParams.delete("startAt");
		else url.searchParams.set("startAt", String(next));
		return `${url.pathname}${url.search}${url.hash}`;
	}
</script>

<PageTitle title={data.page?.queue.name ?? "Queues"} />

{#if data.sidebar}
	<ProjectFrame data={data.sidebar} active="queues">
		<div class="queue-content">
			<div class="queue-header">
				<h1>{queueName}</h1>
				<span class="total">{total} {total === 1 ? "issue" : "issues"}</span>
			</div>

			<div class="table-wrap">
				<table class="fat-table">
					<thead>
						<tr>
							{#each columns as column (column.id)}
								<th>{column.label}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#if loading}
							<tr>
								<td class="subtle" colspan={columnCount}>Loading…</td>
							</tr>
						{:else}
							{#each data.page?.issues ?? [] as issue (issue.key)}
								<tr>
									{#each columns as column (column.id)}
										{@const cell = issue.cells[column.id] ?? emptyCell(column.kind)}
										<td><Cell {cell} /></td>
									{/each}
								</tr>
							{/each}
							{#if data.page?.issues.length === 0}
								<tr>
									<td class="subtle" colspan={columnCount}>This queue is empty.</td>
								</tr>
							{/if}
						{/if}
					</tbody>
				</table>
			</div>

			<div class="pager">
				<span class="subtle">{start}–{end} of {total}</span>
				<div class="pager-buttons">
					{#if offset > 0}
						<a
							class="pager-button"
							href={pageHref(Math.max(0, offset - queuePageSize))}
						>
							Previous
						</a>
					{:else}
						<span class="pager-button" aria-disabled="true">Previous</span>
					{/if}
					{#if end < total}
						<a class="pager-button" href={pageHref(offset + queuePageSize)}>
							Next
						</a>
					{:else}
						<span class="pager-button" aria-disabled="true">Next</span>
					{/if}
				</div>
			</div>

			{#if data.page && !loading}
				<p class="jql">JQL: <code>{data.page.queue.jql}</code></p>
			{/if}
		</div>
	</ProjectFrame>
{/if}

<style>
	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	.queue-content {
		padding: 20px 24px;
	}

	.queue-header {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 12px;
	}

	.total,
	.subtle {
		color: var(--ds-text-subtle);
	}

	.table-wrap {
		overflow-x: auto;
	}

	table {
		width: 100%;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
	}

	.pager-buttons {
		display: flex;
		gap: 8px;
		margin-left: auto;
	}

	.pager-button {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 10px;
		background-color: var(--ds-background-neutral);
		color: var(--ds-text);
		border: 0;
		border-radius: 3px;
		cursor: pointer;
		font-size: 13px;
		text-decoration: none;
	}

	.pager-button[aria-disabled="true"] {
		opacity: 0.5;
		pointer-events: none;
	}

	.jql {
		margin: 16px 0 0;
		color: var(--ds-text-subtlest);
		font-size: 12px;
	}
</style>
