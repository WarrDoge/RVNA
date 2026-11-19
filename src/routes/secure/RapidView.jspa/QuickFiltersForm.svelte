<script lang="ts">
	import { untrack } from "svelte";
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import type { BoardConfig, BoardQuickFilter } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import SaveRow from "./SaveRow.svelte";

	interface Props {
		board: BoardConfig;
		canEdit: boolean;
	}

	let { board, canEdit }: Props = $props();

	let filters = $state<BoardQuickFilter[]>(untrack(() => board.quickFilters));
	let saved = $state(false);
	let error = $state<string | null>(null);
	let pending = $state(false);

	function updateFilter(index: number, values: Partial<BoardQuickFilter>) {
		filters = filters.map((filter, itemIndex) =>
			itemIndex === index ? { ...filter, ...values } : filter,
		);
		saved = false;
	}

	async function save() {
		if (pending) return;
		pending = true;
		saved = false;
		error = null;
		try {
			await api(`/api/boards/${board.rapidViewId}/quick-filters`, {
				method: "PUT",
				body: JSON.stringify({
					quickFilters: filters.map((filter) => ({
						name: filter.name,
						jql: filter.jql,
					})),
				}),
			});
			saved = true;
			await invalidate("app:board");
			filters = board.quickFilters;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			pending = false;
		}
	}
</script>

<section class="quick-filters">
	<div class="filter-list">
		{#each filters as filter, index (filter.id)}
			<div class="filter">
				<input
					class="input filter-name"
					aria-label={`Quick filter name ${index + 1}`}
					bind:value={() => filter.name, (value) =>
						updateFilter(index, { name: value })}
					disabled={!canEdit}
				/>
				<input
					class="input"
					aria-label={`Quick filter JQL ${index + 1}`}
					bind:value={() => filter.jql, (value) =>
						updateFilter(index, { jql: value })}
					disabled={!canEdit}
				/>
				<Button
					spacing="compact"
					appearance="danger"
					onclick={() => {
						filters = filters.filter((_, itemIndex) => itemIndex !== index);
						saved = false;
					}}
					isDisabled={!canEdit}
				>
					Remove
				</Button>
			</div>
		{/each}
		<div>
			<Button
				onclick={() => {
					filters = [
						...filters,
						{
							id: crypto.randomUUID(),
							name: "New filter",
							jql: "",
							sequence: filters.length,
						},
					];
					saved = false;
				}}
				isDisabled={!canEdit}
			>
				Add quick filter
			</Button>
		</div>
	</div>
	<div class="save">
		<SaveRow {saved} {error} pending={pending} disabled={!canEdit} onSave={save} />
	</div>
</section>

<style>
	.quick-filters {
		max-width: 760px;
	}

	.filter-list {
		display: grid;
		gap: 8px;
	}

	.filter {
		display: flex;
		gap: 8px;
	}

	.input {
		width: 100%;
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input, #242528);
		border: 1px solid var(--ds-border-input, #7e8188);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		font-size: 14px;
	}

	.filter-name {
		max-width: 220px;
	}

	.save {
		margin-top: 12px;
	}
</style>
