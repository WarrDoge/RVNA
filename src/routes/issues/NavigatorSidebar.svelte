<script lang="ts">
	import type { Filter } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { STANDARD_FILTERS, type StandardFilter } from "./navigator.ts";

	interface Props {
		open: boolean;
		activeFilterId: string;
		favourites: Filter[];
		onToggle: () => void;
		onNewSearch: () => void;
		onRun: (filter: StandardFilter) => void;
	}

	let {
		open,
		activeFilterId,
		favourites,
		onToggle,
		onNewSearch,
		onRun,
	}: Props = $props();
</script>

{#if !open}
	<aside class="sidebar collapsed">
		<button
			type="button"
			aria-label="Show filters"
			onclick={onToggle}
			class="collapse-button"
		>
			»
		</button>
	</aside>
{:else}
	<aside class="sidebar">
		<div class="top">
			<button type="button" onclick={onNewSearch} class="item new-search">
				<Icon name="search" size={14} /> New search
			</button>
			<button
				type="button"
				aria-label="Hide filters"
				onclick={onToggle}
				class="collapse-button"
			>
				«
			</button>
		</div>

		<a href="/secure/ManageFilters.jspa" class="item">Find filters</a>

		<div class="section">Filters</div>
		{#each STANDARD_FILTERS as filter (filter.name)}
			<button type="button" onclick={() => onRun(filter)} class="item">
				{filter.name}
			</button>
		{/each}

		<div class="section spaced">Favorite filters</div>
		{#if favourites.length === 0}
			<p class="empty">You don't have any favorite filters.</p>
		{:else}
			{#each favourites as filter (filter.id)}
				<a
					href={`/issues/?filter=${filter.id}`}
					class="item favourite"
					class:active={filter.id === activeFilterId}
				>
					<span class="star"><Icon name="star-filled" size={12} /></span>
					{filter.name}
				</a>
			{/each}
		{/if}
	</aside>
{/if}

<style>
	.sidebar {
		width: 220px;
		flex: none;
		border-right: 1px solid var(--ds-border, #3b3d42);
		background: var(--ds-surface-sunken, #1d2125);
		padding: 12px 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.sidebar.collapsed {
		width: 32px;
		padding-top: 12px;
		display: flex;
		justify-content: center;
		align-items: flex-start;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.item {
		display: block;
		width: 100%;
		padding: 4px 8px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		text-align: left;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 14px;
		line-height: 20px;
		text-decoration: none;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.new-search {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.collapse-button {
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-text-subtle, #a9abaf);
		cursor: pointer;
	}

	.section {
		padding: 8px 8px 2px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.4px;
		text-transform: uppercase;
	}

	.section.spaced {
		margin-top: 12px;
	}

	.empty {
		margin: 2px 8px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
		line-height: 16px;
	}

	.favourite {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.favourite.active {
		color: var(--ds-text-selected, #669df1);
	}

	.star {
		display: inline-flex;
		color: #ffab00;
	}
</style>
