<script lang="ts">
import type { CumulativeFlowResult } from "#lib/shared/agile-reports/cumulative-flow.ts";
import ChartFrame from "./ChartFrame.svelte";
import Grid from "./Grid.svelte";
import {
	cfdColors,
	chartHeight,
	chartWidth,
	clampIndex,
	dateLabel,
	indexScale,
	margin,
	niceMax,
	plotHeight,
	plotWidth,
	stackedAreaPath,
	textColor,
	valueScale,
	yTicksFor,
} from "./charts.ts";

let {
	data,
	visibleColumnIds,
}: {
	data: CumulativeFlowResult;
	visibleColumnIds: Set<string>;
} = $props();

let hover = $state<{ x: number; y: number; index: number } | null>(null);

$effect(() => {
	if (!hover) return;
	const index = clampIndex(hover.index, dates.length);
	if (index < 0) {
		hover = null;
		return;
	}
	if (index !== hover.index) {
		hover = { ...hover, index, x: xScale(index), y: yScale(totals[index]) };
	}
});

const series = $derived(
	data.series.filter((row) => visibleColumnIds.has(row.columnId)),
);
const dates = $derived(data.dates);
const totals = $derived(
	dates.map((_, index) =>
		series.reduce((sum, row) => sum + row.values[index], 0),
	),
);
const yMax = $derived(niceMax(Math.max(1, ...totals)));
const xScale = $derived(indexScale(dates.length));
const yScale = $derived(valueScale(yMax));
const yTicks = $derived(yTicksFor(yMax));
const xTicks = $derived(
	dates
		.map((date, index) => ({ index, date }))
		.filter(
			(_, index) =>
				index % Math.max(1, Math.ceil(dates.length / 6)) === 0,
		)
		.map(({ index, date }) => ({
			value: index,
			label: dateLabel(`${date}T00:00:00.000Z`),
		})),
);
const stacked = $derived.by(() =>
	series.map((row, seriesIndex) => {
		const below = dates.map((_, index) =>
			series
				.slice(0, seriesIndex)
				.reduce((sum, item) => sum + item.values[index], 0),
		);
		const top = dates.map((_, index) => below[index] + row.values[index]);
		return {
			row,
			path: stackedAreaPath(top, below, xScale, yScale),
			color: cfdColors[seriesIndex % cfdColors.length],
		};
	}),
);

function onMove(event: MouseEvent) {
	if (dates.length === 0) return;
	const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
	const viewX = ((event.clientX - rect.left) / rect.width) * chartWidth;
	const index = clampIndex(
		((viewX - margin.left) / plotWidth) * (dates.length - 1),
		dates.length,
	);
	if (index < 0) return;
	const total = totals[index];
	hover = { x: xScale(index), y: yScale(total), index };
}
</script>

{#snippet tooltipContent()}
	{#if hover && hover.index < dates.length}
		<strong>{dateLabel(`${dates[hover.index]}T00:00:00.000Z`)}</strong>
		{#each series as row, seriesIndex (row.columnId)}
			<div class="cfd-tooltip-row">
				<span style="color: {textColor};">{row.name}</span>
				<span>{row.values[hover.index]}</span>
				<span
					class="cfd-tooltip-swatch"
					style="background-color: {cfdColors[
						seriesIndex % cfdColors.length
					]};"
				></span>
			</div>
		{/each}
		<div class="cfd-tooltip-total">Total: {totals[hover.index]}</div>
	{/if}
{/snippet}

<div>
	<ChartFrame
		tooltip={hover
			? { x: hover.x, y: hover.y, content: tooltipContent }
			: null}
	>
		<svg
			viewBox={`0 0 ${chartWidth} ${chartHeight}`}
			role="img"
			aria-label="Cumulative flow diagram"
			class="cfd-chart"
			onmousemove={onMove}
			onmouseleave={() => {
				hover = null;
			}}
		>
			<Grid {yTicks} {yMax} {xTicks} {xScale} />
			{#each stacked as item (item.row.columnId)}
				<path
					d={item.path}
					fill={item.color}
					opacity={0.82}
					stroke={item.color}
					stroke-width={1}
				/>
			{/each}
		</svg>
	</ChartFrame>
	<div class="cfd-legend" style="color: {textColor};">
		{#each series as row, index (row.columnId)}
			<span class="cfd-legend-item">
				<span
					class="cfd-swatch"
					style="background-color: {cfdColors[
						index % cfdColors.length
					]};"
				></span>
				{row.name}
			</span>
		{/each}
	</div>
</div>

<style>
	.cfd-chart {
		display: block;
		width: 100%;
		height: auto;
	}

	.cfd-tooltip-row {
		display: flex;
		justify-content: space-between;
		gap: 16px;
	}

	.cfd-tooltip-swatch {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}

	.cfd-tooltip-total {
		margin-top: 4px;
		font-weight: 600;
	}

	.cfd-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		padding: 4px 54px 0;
		font-size: 12px;
	}

	.cfd-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.cfd-swatch {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
</style>
