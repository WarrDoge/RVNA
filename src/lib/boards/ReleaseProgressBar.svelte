<script lang="ts">
	import type { EstimateTotals } from "#lib/api-types.ts";

	interface Props {
		counts: EstimateTotals;
		total: number;
		height?: number;
	}

	let { counts, total, height = 8 }: Props = $props();

	const categories = ["done", "indeterminate", "new"] as const;
	const colors = {
		done: "var(--ds-chart-success-bold, #b3df72)",
		indeterminate: "var(--ds-chart-blue-bold, #579dff)",
		new: "var(--ds-chart-gray-bold, #8c9bab)",
	};
</script>

{#if total === 0}
	<div
		class="bar"
		style="height: {height}px; border-radius: {height / 2}px;"
	></div>
{:else}
	<div
		class="bar progress"
		role="progressbar"
		aria-valuemin={0}
		aria-valuemax={total}
		aria-valuenow={counts.done}
		style="height: {height}px; border-radius: {height / 2}px;"
	>
		{#each categories as category (category)}
			{#if counts[category] > 0}
				<div
					style="width: {(counts[category] / total) *
						100}%; background-color: {colors[category]};"
				></div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.bar {
		background-color: var(--ds-background-neutral, #2c333a);
	}

	.progress {
		display: flex;
		overflow: hidden;
	}
</style>
