<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import CardColoursForm from "./CardColoursForm.svelte";
	import ColumnsForm from "./ColumnsForm.svelte";
	import EstimationForm from "./EstimationForm.svelte";
	import GeneralForm from "./GeneralForm.svelte";
	import QuickFiltersForm from "./QuickFiltersForm.svelte";
	import SwimlanesForm from "./SwimlanesForm.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const tabs = [
		{ id: "general", label: "General" },
		{ id: "columns", label: "Columns" },
		{ id: "swimlanes", label: "Swimlanes" },
		{ id: "quick-filters", label: "Quick Filters" },
		{ id: "card-colours", label: "Card colours" },
		{ id: "estimation", label: "Estimation" },
	] as const;

	type TabId = (typeof tabs)[number]["id"];
</script>

<PageTitle title={data.board?.name ?? "Board not found"} />

{#if !data.board}
	<div class="missing">
		<h1>Board not found</h1>
		<a href="/secure/ManageRapidViews.jspa">View all boards</a>
	</div>
{:else}
	<div class="config">
		<div class="heading">
			<h1>{data.board.name}</h1>
			<a
				class="open-board"
				href={`/secure/RapidBoard.jspa?rapidView=${data.board.rapidViewId}`}
			>
				Open board
			</a>
		</div>
		<div class="tabs">
			{#each tabs as item (item.id)}
				<a
					class:active={data.tab === item.id}
					role="button"
					href={`/secure/RapidView.jspa?rapidView=${data.board.rapidViewId}&tab=${item.id}`}
				>
					{item.label}
				</a>
			{/each}
		</div>

		{#if !data.canEdit}
			<p class="read-only">
				Only administrators and the board owner can change this configuration.
			</p>
		{/if}

		{#if data.tab === "general"}
			<GeneralForm board={data.board} canEdit={data.canEdit} />
		{:else if data.tab === "columns"}
			<ColumnsForm board={data.board} canEdit={data.canEdit} />
		{:else if data.tab === "swimlanes"}
			<SwimlanesForm board={data.board} canEdit={data.canEdit} />
		{:else if data.tab === "quick-filters"}
			<QuickFiltersForm board={data.board} canEdit={data.canEdit} />
		{:else if data.tab === "card-colours"}
			<CardColoursForm board={data.board} canEdit={data.canEdit} />
		{:else if data.tab === "estimation"}
			<EstimationForm board={data.board} canEdit={data.canEdit} />
		{/if}
	</div>
{/if}

<style>
	.config {
		padding: 20px 28px;
		max-width: 1100px;
	}

	.missing {
		padding: 32px;
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text, #cecfd2);
	}

	.missing h1 {
		margin: 0 0 16px;
	}

	.heading {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.open-board {
		color: var(--ds-link, #669df1);
		font-size: 13px;
	}

	.tabs {
		display: flex;
		gap: 4px;
		margin: 16px 0;
		border-bottom: 1px solid var(--ds-border, #3b3d42);
	}

	.tabs a {
		padding: 8px 12px;
		text-decoration: none;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--ds-text-subtle, #a9abaf);
		font-weight: 400;
		cursor: pointer;
	}

	.tabs a.active {
		border-bottom-color: var(--ds-border-selected, #669df1);
		color: var(--ds-text, #cecfd2);
		font-weight: 600;
	}

	.read-only {
		color: var(--ds-text-subtle, #a9abaf);
	}
</style>
