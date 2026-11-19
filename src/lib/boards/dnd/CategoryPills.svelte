<script lang="ts">
	import type { EstimateTotals } from "#lib/api-types.ts";

	interface Props {
		totals: EstimateTotals;
	}

	let { totals }: Props = $props();

	const categories = [
		{ key: "new" as const, colour: "#6b6e76", label: "To Do" },
		{ key: "indeterminate" as const, colour: "#4bade8", label: "In Progress" },
		{ key: "done" as const, colour: "#57a55a", label: "Done" },
	];
</script>

<span class="category-pills" title="Estimate totals">
	{#each categories as category (category.key)}
		<span
			class="category-pill"
			title={`${category.label}: ${totals[category.key]}`}
			style="--category-colour: {category.colour};"
		>
			{totals[category.key]}
		</span>
	{/each}
</span>

<style>
	.category-pills {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.category-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 10px;
		background-color: var(--category-colour);
		color: #1d2125;
		font-size: 11px;
		font-weight: 700;
	}
</style>
