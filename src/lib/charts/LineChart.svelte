<script lang="ts">
	import { token } from "#lib/tokens.ts";

	interface Props {
		series: { days: string[]; created: number[]; resolved: number[] };
	}

	let { series }: Props = $props();

	const width = 600;
	const height = 150;
	const padding = { left: 28, right: 8, top: 8, bottom: 18 };
	const max = $derived(
		Math.max(1, ...series.created, ...series.resolved),
	);
	const step = $derived(
		series.days.length > 1
			? (width - padding.left - padding.right) / (series.days.length - 1)
			: 0,
	);
	function y(value: number) {
		return (
			padding.top +
			(height - padding.top - padding.bottom) * (1 - value / max)
		);
	}
	function points(values: number[]) {
		return values
			.map((value, index) => `${padding.left + index * step},${y(value)}`)
			.join(" ");
	}
	const labelEvery = $derived(
		Math.max(1, Math.ceil(series.days.length / 6)),
	);
	const grid = [0, 0.5, 1];
	const blue = token("color.chart.blue.bold");
	const green = token("color.chart.green.bold");
</script>

<div>
	<svg
		width="100%"
		height={height}
		viewBox={`0 0 ${width} ${height}`}
		role="img"
		aria-label="Issues created and resolved per day"
		preserveAspectRatio="none"
	>
		{#each grid as fraction (fraction)}
			<line
				x1={padding.left}
				x2={width - padding.right}
				y1={y(max * fraction)}
				y2={y(max * fraction)}
				stroke={token("color.border")}
				stroke-width={1}
			/>
		{/each}
		<text x={0} y={y(max) + 4} font-size={10} fill={token("color.text.subtle")}
			>{max}</text
		>
		<text x={0} y={y(0) + 4} font-size={10} fill={token("color.text.subtle")}
			>0</text
		>
		<polyline
			points={points(series.created)}
			fill="none"
			stroke={blue}
			stroke-width={2}
		/>
		<polyline
			points={points(series.resolved)}
			fill="none"
			stroke={green}
			stroke-width={2}
		/>
		{#each series.days as day, index (day)}
			{#if index % labelEvery === 0}
				<text
					x={padding.left + index * step}
					y={height - 4}
					font-size={10}
					fill={token("color.text.subtle")}
					text-anchor="middle">{day.slice(5)}</text
				>
			{/if}
		{/each}
	</svg>
	<div class="legend">
		<span><span style="color: {blue};">■</span> Created</span>
		<span><span style="color: {green};">■</span> Resolved</span>
	</div>
</div>

<style>
	.legend {
		display: flex;
		gap: 16px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}
</style>
