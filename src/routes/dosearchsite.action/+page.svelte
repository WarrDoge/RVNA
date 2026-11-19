<script lang="ts">
	import { untrack } from "svelte";
	import { hydratingPage } from "#lib/hydration.ts";
	import "#lib/wiki/wiki.css";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import { formatDate, pageHref } from "#lib/wiki/format.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let filters = $state({
		...untrack(() => data.filters),
		space: hydratingPage() ? undefined : untrack(() => data.filters.space),
	});
	// A refresh delivers a new object with the same values; only a real change may replace typed text.
	let loadedFilters = untrack(() => JSON.stringify(data.filters));
	$effect(() => {
		const next = JSON.stringify(data.filters);
		if (next === loadedFilters) return;
		loadedFilters = next;
		filters = { ...data.filters };
	});

	let total = $derived(data.results.total);
	let page = $derived(Math.floor(data.filters.offset / data.limit) + 1);
	let pages = $derived(Math.max(1, Math.ceil(total / data.limit)));

	function appliedParams(offset: number) {
		const search = new URLSearchParams();
		const applied = data.filters;
		if (applied.queryString.trim() !== "") {
			search.set("queryString", applied.queryString.trim());
		}
		if (applied.space) search.set("space", applied.space);
		if (applied.contributor) search.set("contributor", applied.contributor);
		if (applied.from) search.set("from", applied.from);
		if (applied.to) search.set("to", applied.to);
		if (offset > 0) search.set("offset", String(offset));
		return search;
	}
</script>

<PageTitle title="Search" />

<section class="search-page">
	<h1>Search</h1>
	<form class="wiki-filters" method="get" action="/dosearchsite.action">
		<label class="wiki-field search-field">
			Search
			<input
				type="search"
				name="queryString"
				bind:value={filters.queryString}
				placeholder="Search pages"
			/>
		</label>
		<label class="wiki-field">
			Space
			<select name="space" bind:value={filters.space}>
				<option value="">All spaces</option>
				{#each data.spaces as item (item.id)}
					<option value={item.key}>{item.name}</option>
				{/each}
			</select>
		</label>
		<label class="wiki-field">
			Contributor
			<input
				type="text"
				name="contributor"
				bind:value={filters.contributor}
				placeholder="username"
			/>
		</label>
		<label class="wiki-field">
			Updated from
			<input type="date" name="from" bind:value={filters.from} />
		</label>
		<label class="wiki-field">
			Updated to
			<input type="date" name="to" bind:value={filters.to} />
		</label>
		<button type="submit" class="submit">Search</button>
	</form>

	<p class="summary">
		{total} result{total === 1 ? "" : "s"} for “{data.filters.queryString}”{total >
		0
			? ` · page ${page} of ${pages}`
			: ""}
	</p>
	{#each data.results.hits as hit (hit.id)}
		<div class="wiki-search-hit">
			<h3>
				<a href={pageHref(hit)}>{hit.title}</a>
			</h3>
			<div class="wiki-search-meta">
				{hit.spaceName} · updated {formatDate(hit.updated)}{hit.author
					? ` by ${hit.author}`
					: ""}
			</div>
			<div class="wiki-search-excerpt">{@html hit.excerpt}</div>
		</div>
	{/each}
	{#if total > data.limit}
		<div class="pager">
			{#if data.filters.offset === 0}
				<span class="pager-disabled">Previous</span>
			{:else}
				<a
					href={`/dosearchsite.action?${appliedParams(
						Math.max(0, data.filters.offset - data.limit),
					).toString()}`}
				>
					Previous
				</a>
			{/if}
			{#if data.filters.offset + data.limit >= total}
				<span class="pager-disabled">Next</span>
			{:else}
				<a
					href={`/dosearchsite.action?${appliedParams(
						data.filters.offset + data.limit,
					).toString()}`}
				>
					Next
				</a>
			{/if}
		</div>
	{/if}
</section>

<style>
	.search-page {
		padding: 24px 32px 48px;
		max-width: 960px;
	}

	h1 {
		margin: 0 0 12px;
		font-size: 24px;
		font-weight: 500;
	}

	.search-field {
		flex: 1 1 260px;
	}

	.submit {
		height: 30px;
		padding: 0 12px;
		background: var(--ds-background-brand-bold);
		color: var(--ds-text-inverse);
		border: 0;
		border-radius: 3px;
		font-weight: 600;
		cursor: pointer;
	}

	.summary {
		color: var(--ds-text-subtle);
		margin: 0 0 4px;
	}

	.pager {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}

	.pager-disabled {
		color: var(--ds-text-disabled);
	}
</style>
