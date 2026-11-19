<script lang="ts">
	import BarList from "#lib/charts/BarList.svelte";
	import LineChart from "#lib/charts/LineChart.svelte";
	import MatrixTable from "#lib/charts/MatrixTable.svelte";
	import PieChart from "#lib/charts/PieChart.svelte";
	import { isSafeLinkUrl } from "#lib/shared/gadgets.ts";
	import GadgetIssueList from "./GadgetIssueList.svelte";
	import type { GadgetData } from "#lib/dashboards/types.ts";

	interface Props {
		data: GadgetData;
		onStartAt: (startAt: number) => void;
	}

	let { data, onStartAt }: Props = $props();

	function columnsOf(config: Record<string, unknown>) {
		const columns = Array.isArray(config.columns)
			? config.columns.filter(
					(item): item is string =>
						typeof item === "string" && !item.startsWith("customfield_"),
				)
			: [];
		return columns.length > 0
			? columns
			: ["type", "key", "summary", "priority", "status"];
	}

	const columns = $derived(columnsOf(data.config));
	const safeLinks = $derived(
		(data.links ?? []).filter((link) => isSafeLinkUrl(link.url)),
	);
</script>

{#if data.issueList}
	<GadgetIssueList list={data.issueList} {columns} {onStartAt} />
{:else if data.slices}
	{#if data.kind === "pie-chart"}
		<PieChart slices={data.slices} />
	{:else}
		<BarList slices={data.slices} />
	{/if}
{:else if data.matrix}
	<MatrixTable matrix={data.matrix} />
{:else if data.series}
	<LineChart series={data.series} />
{:else if data.activity}
	{#if data.activity.length === 0}
		<p class="muted">No activity yet.</p>
	{:else}
		<div class="activity">
			{#each data.activity as group (group.day)}
				<div>
					<div class="day">{group.day}</div>
					<ul>
						{#each group.entries as entry (`${entry.kind}-${entry.issueKey}-${entry.created}`)}
							<li>
								<span class="kind muted">
									{entry.kind === "created"
										? "created"
										: entry.kind === "comment"
											? "commented on"
											: "updated"}
								</span>
								<a href={`/browse/${entry.issueKey}`} class="link">
									{entry.issueKey}
								</a>
								<span class="text">
									{entry.kind === "created"
										? entry.issueSummary
										: (entry.text ?? entry.issueSummary)}
								</span>
								<span class="author muted">
									{entry.author?.displayName ?? "Unknown"}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	{/if}
{:else if data.filters}
	{#if data.filters.length === 0}
		<p class="muted">No favourite filters yet.</p>
	{:else}
		<ul class="plain">
			{#each data.filters as filter (filter.id)}
				<li class="entry">
					<a href={`/issues/?filter=${filter.id}`} class="link">{filter.name}</a>
					{" "}
					<span class="muted">({filter.total})</span>
					{#if filter.description}
						<div class="muted">{filter.description}</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{:else if data.links}
	{#if safeLinks.length === 0}
		<p class="muted">No links yet.</p>
	{:else}
		<ul class="plain">
			{#each safeLinks as link (`${link.title}-${link.url}`)}
				<li class="entry">
					<a href={link.url} class="link" rel="noreferrer">{link.title}</a>
				</li>
			{/each}
		</ul>
	{/if}
{:else if data.html !== undefined}
	{#if data.html === ""}
		<div class="fat-rich-text">
			<h3>Welcome to RVNA</h3>
			<p>
				Not sure where to start? Use the search bar at the top or the Issues
				menu to find the work that matters to you.
			</p>
			<p>
				An administrator can replace this text with the configure button of
				this gadget.
			</p>
		</div>
	{:else}
		<div class="fat-rich-text">{@html data.html}</div>
	{/if}
{:else}
	<div class="unknown">
		This dashboard uses a gadget RVNA does not have yet:{" "}
		<strong>{data.title || data.kind}</strong>.
	</div>
{/if}

<style>
	.muted {
		color: var(--ds-text-subtle);
	}
	p.muted {
		margin: 0;
	}
	.activity {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.day {
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
		margin-bottom: 4px;
	}
	.activity ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.activity li {
		display: flex;
		gap: 6px;
		padding: 2px 0;
		font-size: 13px;
	}
	.kind {
		flex: none;
	}
	.link {
		color: var(--ds-link);
		text-decoration: none;
	}
	.activity .link {
		flex: none;
	}
	.text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.author {
		margin-left: auto;
		flex: none;
	}
	.plain {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 13px;
	}
	.entry {
		padding: 3px 0;
	}
	.unknown {
		padding: 16px 12px;
		border: 1px dashed var(--ds-border);
		border-radius: 3px;
		color: var(--ds-text-subtle);
	}
	.unknown strong {
		color: var(--ds-text);
	}
</style>
