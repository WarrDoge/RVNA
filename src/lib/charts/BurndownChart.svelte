<script lang="ts">
import type {
	BurndownEventRow,
	BurndownPoint,
	BurndownResult,
} from "#lib/shared/agile-reports/burndown.ts";
import {
	type EstimationStatistic,
	formatEstimate,
} from "#lib/shared/agile-reports/types.ts";
import ChartFrame from "./ChartFrame.svelte";
import Grid from "./Grid.svelte";
import Legend from "./Legend.svelte";
import {
	chartHeight,
	chartWidth,
	dateLabel,
	dateTimeLabel,
	guidelineColor,
	guidelinePath,
	lineColor,
	margin,
	niceMax,
	nonWorkingColor,
	plotHeight,
	plotWidth,
	stepPath,
	textColor,
	timeScale,
	valueScale,
	yTicksFor,
} from "./charts.ts";

let {
	data,
	start,
	end,
	estimation,
}: {
	data: BurndownResult;
	start: string;
	end: string;
	estimation: EstimationStatistic;
} = $props();

let svg = $state<SVGSVGElement | null>(null);
let hover = $state<{
	x: number;
	y: number;
	point: BurndownPoint;
	eventRow: BurndownEventRow | undefined;
} | null>(null);

const startTime = $derived(
	Math.min(
		new Date(start).getTime(),
		...data.points.map((point) => new Date(point.at).getTime()),
	),
);
const endTime = $derived(
	Math.max(
		new Date(end).getTime(),
		...data.points.map((point) => new Date(point.at).getTime()),
	),
);
const span = $derived(Math.max(1, endTime - startTime));
const yMax = $derived(
	niceMax(
		Math.max(
			data.initialScope,
			...data.points.map((point) => point.remaining),
			...data.guideline.map((point) => point.remaining),
			1,
		),
	),
);
const xScale = $derived(timeScale(startTime, span));
const yScale = $derived(valueScale(yMax));
const yTicks = $derived(yTicksFor(yMax));
const xTicks = $derived(
	Array.from({ length: 6 }, (_, index) => {
		const value = startTime + (span * index) / 5;
		return { value, label: dateLabel(new Date(value).toISOString()) };
	}),
);
const path = $derived(stepPath(data.points, xScale, yScale));
const guideline = $derived(guidelinePath(data.guideline, xScale, yScale));

function onMove(event: MouseEvent) {
	const rect = svg?.getBoundingClientRect();
	if (!rect || data.points.length === 0) return;
	const viewX = ((event.clientX - rect.left) / rect.width) * chartWidth;
	const time = startTime + ((viewX - margin.left) / plotWidth) * span;
	let nearest = data.points[0];
	for (const point of data.points) {
		if (
			Math.abs(new Date(point.at).getTime() - time) <
			Math.abs(new Date(nearest.at).getTime() - time)
		) {
			nearest = point;
		}
	}
	const eventRow = data.eventRows.find((row) => row.at === nearest.at);
	hover = {
		x: xScale(new Date(nearest.at).getTime()),
		y: yScale(nearest.remaining),
		point: nearest,
		eventRow,
	};
}
</script>

{#snippet tooltipContent()}
	{#if hover}
		<strong>{dateTimeLabel(hover.point.at)}</strong>
		<div>Remaining: {formatEstimate(hover.point.remaining, estimation)}</div>
		{#if hover.eventRow}
			<div style="color: {textColor};">
				{hover.eventRow.issueKey} · {hover.eventRow.eventType.replaceAll(
					"-",
					" ",
				)}
			</div>
		{/if}
	{/if}
{/snippet}

<div>
	<ChartFrame
		tooltip={hover
			? { x: hover.x, y: hover.y, content: tooltipContent }
			: null}
	>
		<svg
			bind:this={svg}
			viewBox={`0 0 ${chartWidth} ${chartHeight}`}
			role="img"
			aria-label="Burndown chart"
			style="display: block; width: 100%; height: auto;"
			onmousemove={onMove}
			onmouseleave={() => {
				hover = null;
			}}
		>
			{#each data.nonWorkingDays as date (date)}
				{@const day = new Date(`${date}T00:00:00.000Z`).getTime()}
				{@const next = day + 24 * 60 * 60 * 1000}
				{@const x = xScale(day)}
				{@const width = xScale(next) - x}
				{#if width > 0}
					<rect
						x={x}
						y={margin.top}
						width={width}
						height={plotHeight}
						fill={nonWorkingColor}
						opacity={0.55}
					/>
				{/if}
			{/each}
			<Grid {yTicks} {yMax} {xTicks} {xScale} />
			<path
				d={guideline}
				fill="none"
				stroke={guidelineColor}
				stroke-width={1.5}
				stroke-dasharray="6 4"
			/>
			<path
				d={path}
				fill="none"
				stroke={lineColor}
				stroke-width={2.5}
				stroke-linejoin="round"
			/>
			{#each data.points as point, index (index)}
				<circle
					cx={xScale(new Date(point.at).getTime())}
					cy={yScale(point.remaining)}
					r={3}
					fill={lineColor}
				/>
			{/each}
		</svg>
	</ChartFrame>
	<Legend
		items={[
			{ color: lineColor, label: "Remaining" },
			{ color: guidelineColor, label: "Guideline", dashed: true },
			{ color: nonWorkingColor, label: "Non-working day" },
		]}
	/>
</div>
