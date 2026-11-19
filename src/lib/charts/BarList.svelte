<script lang="ts">
	import { token } from "#lib/tokens.ts";

	interface Props {
		slices: { label: string; value: number }[];
	}

	let { slices }: Props = $props();

	const total = $derived(slices.reduce((sum, slice) => sum + slice.value, 0));
	const max = $derived(Math.max(...slices.map((slice) => slice.value)));
</script>

{#if total === 0}
	<p class="muted">No issues.</p>
{:else}
	<div class="bars">
		{#each slices as slice (slice.label)}
			<div class="row">
				<span class="label">{slice.label}</span>
				<span class="track">
					<span
						class="fill"
						style="width: {max === 0
							? 0
							: Math.round((slice.value / max) * 100)}%; background: {token(
							'color.chart.blue.bold',
						)};"
					></span>
				</span>
				<span class="value muted">{slice.value}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.muted {
		color: var(--ds-text-subtle);
	}
	p {
		margin: 0;
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 160px 44px;
		gap: 8px;
		align-items: center;
		font-size: 13px;
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.track {
		height: 10px;
		border-radius: 2px;
		background: var(--ds-background-neutral);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
	}
	.value {
		text-align: right;
	}
</style>
