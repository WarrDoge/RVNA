<script lang="ts">
import {
	axisColor,
	chartHeight,
	chartWidth,
	margin,
	plotHeight,
	textColor,
} from "./charts.ts";

let {
	yTicks,
	yMax,
	xTicks,
	xScale,
}: {
	yTicks: number[];
	yMax: number;
	xTicks: { value: number; label: string }[];
	xScale: (value: number) => number;
} = $props();
</script>

{#each yTicks as tick (tick)}
	{@const y = margin.top + plotHeight - (tick / yMax) * plotHeight}
	<g>
		<line
			x1={margin.left}
			x2={chartWidth - margin.right}
			y1={y}
			y2={y}
			stroke={axisColor}
			stroke-width={1}
		/>
		<text
			x={margin.left - 8}
			y={y + 4}
			text-anchor="end"
			fill={textColor}
			font-size={11}
		>
			{tick}
		</text>
	</g>
{/each}
{#each xTicks as tick (tick.value)}
	<text
		x={xScale(tick.value)}
		y={chartHeight - 18}
		text-anchor="middle"
		fill={textColor}
		font-size={11}
	>
		{tick.label}
	</text>
{/each}
