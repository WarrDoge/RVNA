<script lang="ts">
	import "#lib/wiki/wiki.css";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import SpaceAvatar from "#lib/wiki/SpaceAvatar.svelte";
	import { spaceHref } from "#lib/wiki/format.ts";
	import type { SpaceSummary } from "#lib/wiki/types.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Tab = "site" | "personal" | "all";
	let tab = $state<Tab>("site");
	let filter = $state("");

	const tabs: { id: Tab; label: string }[] = [
		{ id: "site", label: "Site spaces" },
		{ id: "personal", label: "Personal spaces" },
		{ id: "all", label: "All spaces" },
	];

	let visible = $derived(
		data.spaces.filter((space) => {
			if (tab === "site" && space.type !== "global") return false;
			if (tab === "personal" && space.type !== "personal") return false;
			const needle = filter.trim().toLowerCase();
			if (needle === "") return true;
			return (
				space.name.toLowerCase().includes(needle) ||
				space.key.toLowerCase().includes(needle) ||
				(space.descriptionHtml ?? "").toLowerCase().includes(needle)
			);
		}),
	);

	function description(space: SpaceSummary) {
		return (space.descriptionHtml ?? "")
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}
</script>

<PageTitle title="Spaces" />

<div class="wiki-directory">
	<nav class="wiki-directory-nav" aria-label="Space directory">
		{#each tabs as item (item.id)}
			<button
				type="button"
				class="wiki-directory-tab tab-button"
				class:is-active={tab === item.id}
				onclick={() => (tab = item.id)}
			>
				{item.label}
			</button>
		{/each}
	</nav>

	<div class="wiki-directory-main">
		<div class="wiki-directory-head">
			<h1>
				{tab === "site"
					? "Site Spaces"
					: tab === "personal"
						? "Personal Spaces"
						: "All Spaces"}
			</h1>
			<input
				type="search"
				placeholder="Filter"
				aria-label="Filter spaces"
				bind:value={filter}
			/>
		</div>

		<p class="summary">
			Showing {visible.length} result{visible.length === 1 ? "" : "s"}
		</p>

		<table class="fat-table table">
			<thead>
				<tr>
					<th>Space</th>
					<th>Key</th>
					<th>Description</th>
					<th>Pages</th>
				</tr>
			</thead>
			<tbody>
				{#each visible as space (space.id)}
					<tr>
						<td>
							<span class="wiki-space-cell">
								<SpaceAvatar
									name={space.name}
									iconPath={space.iconPath}
									size={24}
								/>
								<a href={spaceHref(space.key)}>{space.name}</a>
							</span>
						</td>
						<td class="muted">{space.key}</td>
						<td class="muted">{description(space).slice(0, 140)}</td>
						<td class="muted">{space.pageCount}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if visible.length === 0}
			<p class="wiki-list-empty">No spaces match this filter.</p>
		{/if}
	</div>
</div>

<style>
	.wiki-directory-tab.tab-button {
		text-align: left;
		border: 0;
		background: transparent;
	}

	.wiki-directory-tab.tab-button.is-active {
		background: transparent;
	}

	.summary {
		margin: 0 0 8px;
		color: var(--ds-text-subtle);
	}

	.table {
		width: 100%;
	}

	.muted {
		color: var(--ds-text-subtle);
	}
</style>
