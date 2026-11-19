<script lang="ts">
import type { Snippet } from "svelte";
import {
	axisColor,
	chartHeight,
	chartWidth,
	tooltipBackground,
	tooltipShadow,
	tooltipTextColor,
} from "./charts.ts";

type Tooltip = { x: number; y: number; content: Snippet };

let { children, tooltip }: { children: Snippet; tooltip: Tooltip | null } =
	$props();
</script>

<div class="chart-frame">
	{@render children()}
	{#if tooltip}
		<div
			class="chart-tooltip"
			data-testid="chart-tooltip"
			style="left: {(tooltip.x / chartWidth) *
				100}%; top: {(tooltip.y / chartHeight) *
				100}%; background-color: {tooltipBackground}; border-color: {axisColor}; box-shadow: {tooltipShadow}; color: {tooltipTextColor};"
		>
			{@render tooltip.content()}
		</div>
	{/if}
</div>

<style>
	.chart-frame {
		position: relative;
		width: 100%;
	}

	.chart-tooltip {
		position: absolute;
		transform: translate(-50%, -110%);
		pointer-events: none;
		min-width: 150px;
		max-width: 280px;
		padding: 8px 10px;
		border: 1px solid;
		border-radius: 3px;
		font-size: 12px;
		line-height: 18px;
		z-index: 5;
	}
</style>
