<script lang="ts">
	import Icon from "#lib/components/Icon.svelte";

	interface Props {
		startAt: number;
		pageSize: number;
		total: number;
		onChange: (startAt: number) => void;
		compact?: boolean;
	}

	let { startAt, pageSize, total, onChange, compact = false }: Props = $props();

	let start = $derived(total === 0 ? 0 : startAt + 1);
	let end = $derived(Math.min(startAt + pageSize, total));
</script>

<div class="pager" class:compact>
	<span class="range">{start}–{end} of {total}</span>
	<div class="buttons">
		<button
			type="button"
			aria-label="Previous page"
			disabled={startAt === 0}
			onclick={() => onChange(Math.max(0, startAt - pageSize))}
			class="pager-button"
		>
			<Icon name="chevron-left" />
		</button>
		<button
			type="button"
			aria-label="Next page"
			disabled={end >= total}
			onclick={() => onChange(startAt + pageSize)}
			class="pager-button"
		>
			<Icon name="chevron-right" />
		</button>
	</div>
</div>

<style>
	.pager {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
	}

	.pager.compact {
		margin-top: 0;
		padding: 6px 8px;
	}

	.range {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 14px;
	}

	.compact .range {
		font-size: 12px;
	}

	.buttons {
		display: flex;
		gap: 4px;
		margin-left: auto;
	}

	.pager-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		color: var(--ds-text-subtle, #a9abaf);
		cursor: pointer;
	}

	.pager-button:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
