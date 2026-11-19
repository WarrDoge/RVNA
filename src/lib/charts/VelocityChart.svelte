<script lang="ts">
import {
	type EstimationStatistic,
	formatEstimate,
} from "#lib/shared/agile-reports/types.ts";
import type { VelocitySprint } from "#lib/shared/agile-reports/velocity.ts";
import ChartFrame from "./ChartFrame.svelte";
import Grid from "./Grid.svelte";
import Legend from "./Legend.svelte";
import {
	chartHeight,
	chartWidth,
	commitmentColor,
	completedColor,
	margin,
	niceMax,
	plotHeight,
	plotWidth,
	shortName,
	textColor,
	valueScale,
	yTicksFor,
} from "./charts.ts";

let {
	sprints,
	averageCompleted,
	averageCommitment,
	estimation,
}: {
	sprints: VelocitySprint[];
	averageCompleted: number;
	averageCommitment: number;
	estimation: EstimationStatistic;
} = $props();

let hover = $state<{
	x: number;
	y: number;
	sprint: VelocitySprint;
} | null>(null);

const yMax = $derived(
	niceMax(
		Math.max(
			1,
			...sprints.map((sprint) =>
				Math.max(sprint.commitment, sprint.completed),
			),
			averageCompleted,
			averageCommitment,
		),
	),
);
const group = $derived(plotWidth / Math.max(1, sprints.length));
const barWidth = $derived(Math.min(36, group * 0.28));
const yScale = $derived(valueScale(yMax));
const yTicks = $derived(yTicksFor(yMax));

function onMove(event: MouseEvent) {
	const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
	const viewX = ((event.clientX - rect.left) / rect.width) * chartWidth;
	const index = Math.floor((viewX - margin.left) / group);
	if (index < 0 || index >= sprints.length) {
		hover = null;
		return;
	}
	const sprint = sprints[index];
	const center = margin.left + group * index + group / 2;
	hover = {
		x: center,
		y: yScale(Math.max(sprint.commitment, sprint.completed)),
		sprint,
	};
}
</script>

{#snippet tooltipContent()}
	{#if hover}
		<strong>{hover.sprint.name}</strong>
		<div>
			Commitment: {formatEstimate(hover.sprint.commitment, estimation)}
		</div>
		<div>Completed: {formatEstimate(hover.sprint.completed, estimation)}</div>
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
			aria-label="Velocity chart"
			style="display: block; width: 100%; height: auto;"
			onmousemove={onMove}
			onmouseleave={() => {
				hover = null;
			}}
		>
			<Grid {yTicks} {yMax} xTicks={[]} xScale={(value) => value} />
			{#each sprints as sprint, index (sprint.id)}
				{@const center = margin.left + group * index + group / 2}
				{@const commitmentX = center - barWidth - 2}
				{@const completedX = center + 2}
				<g>
					<rect
						x={commitmentX}
						y={yScale(sprint.commitment)}
						width={barWidth}
						height={margin.top + plotHeight - yScale(sprint.commitment)}
						fill={commitmentColor}
						rx={2}
					/>
					<rect
						x={completedX}
						y={yScale(sprint.completed)}
						width={barWidth}
						height={margin.top + plotHeight - yScale(sprint.completed)}
						fill={completedColor}
						rx={2}
					/>
					<text
						x={center}
						y={chartHeight - 22}
						text-anchor="middle"
						fill={textColor}
						font-size={10}
					>
						{shortName(sprint.name)}
					</text>
				</g>
			{/each}
			<line
				x1={margin.left}
				x2={chartWidth - margin.right}
				y1={yScale(averageCompleted)}
				y2={yScale(averageCompleted)}
				stroke={completedColor}
				stroke-width={1.5}
				stroke-dasharray="5 4"
			/>
			<line
				x1={margin.left}
				x2={chartWidth - margin.right}
				y1={yScale(averageCommitment)}
				y2={yScale(averageCommitment)}
				stroke={commitmentColor}
				stroke-width={1.5}
				stroke-dasharray="2 4"
			/>
		</svg>
	</ChartFrame>
	<Legend
		items={[
			{ color: commitmentColor, label: "Commitment" },
			{ color: completedColor, label: "Completed" },
			{ color: completedColor, label: "Average completed", dashed: true },
			{ color: commitmentColor, label: "Average commitment", dashed: true },
		]}
	/>
</div>
