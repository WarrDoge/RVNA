<script lang="ts">
	import { type TokenName, token } from "#lib/tokens.ts";

	interface Props {
		slices: { label: string; value: number }[];
	}

	let { slices }: Props = $props();

	const chartColors = [
		"color.chart.categorical.1",
		"color.chart.categorical.2",
		"color.chart.categorical.3",
		"color.chart.categorical.4",
		"color.chart.categorical.5",
		"color.chart.categorical.6",
		"color.chart.categorical.7",
		"color.chart.categorical.8",
		"color.chart.blue.bold",
		"color.chart.gray.bold",
	];

	function sliceColor(index: number) {
		return token(chartColors[index % chartColors.length] as TokenName);
	}

	const total = $derived(slices.reduce((sum, slice) => sum + slice.value, 0));
	const radius = 62;
	const centre = 70;

	const paths = $derived.by(() => {
		let angle = -Math.PI / 2;
		return slices.map((slice, index) => {
			const sweep = (slice.value / total) * Math.PI * 2;
			const start = angle;
			const end = angle + sweep;
			angle = end;
			const large = sweep > Math.PI ? 1 : 0;
			const path =
				slices.length === 1
					? null
					: [
							`M ${centre} ${centre}`,
							`L ${centre + radius * Math.cos(start)} ${centre + radius * Math.sin(start)}`,
							`A ${radius} ${radius} 0 ${large} 1 ${centre + radius * Math.cos(end)} ${centre + radius * Math.sin(end)}`,
							"Z",
						].join(" ");
			return { label: slice.label, path, fill: sliceColor(index) };
		});
	});
</script>

{#if total === 0}
	<p class="muted">No issues.</p>
{:else}
	<div class="pie">
		<svg
			width={140}
			height={140}
			viewBox="0 0 140 140"
			role="img"
			aria-label={`Pie chart of ${slices.length} statistics`}
		>
			{#if slices.length === 1}
				<circle cx={centre} cy={centre} r={radius} fill={sliceColor(0)} />
			{:else}
				{#each paths as path (path.label)}
					<path
						d={path.path ?? undefined}
						fill={path.fill}
						stroke={token("elevation.surface")}
						stroke-width={1}
					/>
				{/each}
			{/if}
		</svg>
		<ul>
			{#each slices as slice, index (slice.label)}
				<li>
					<span
						class="swatch"
						style="background: {sliceColor(index)};"
					></span>
					<span class="label">{slice.label}</span>
					<span class="muted">{slice.value}</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.muted {
		color: var(--ds-text-subtle);
	}
	p {
		margin: 0;
	}
	.pie {
		display: flex;
		gap: 16px;
		align-items: center;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 13px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		flex: none;
	}
	.label {
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
