<script lang="ts">
import { textColor } from "./charts.ts";

let {
	items,
}: {
	items: { color: string; label: string; dashed?: boolean }[];
} = $props();
</script>

<div class="legend" style="color: {textColor};">
	{#each items as item (item.label)}
		<span class="legend-item">
			<svg width={18} height={8} aria-hidden="true">
				<line
					x1={0}
					x2={18}
					y1={4}
					y2={4}
					stroke={item.color}
					stroke-width={2}
					stroke-dasharray={item.dashed ? "4 3" : undefined}
				/>
			</svg>
			{item.label}
		</span>
	{/each}
</div>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		padding: 4px 54px 0;
		font-size: 12px;
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
</style>
