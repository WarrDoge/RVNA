<script lang="ts">
	interface Props {
		name: string;
		count: number;
		min: number | null;
		max: number | null;
	}

	let { name, count, min, max }: Props = $props();

	let over = $derived(max !== null && count > max);
	let under = $derived(min !== null && count < min);
</script>

<div class="column-header" class:over class:under>
	<div class="column-title">
		<span class="name">{name}</span>
		<span class="count">{count}</span>
		{#if over}
			<span class="over-mark" title={`Over the WIP limit of ${max}`}>!</span>
		{/if}
		{#if under}
			<span class="under-mark" title={`Under the minimum of ${min}`}>!</span>
		{/if}
	</div>
</div>

<style>
	.column-header {
		min-width: 0;
		padding: 4px 8px;
		background-color: var(--ds-surface-sunken, #161719);
		border-radius: 3px;
	}

	.column-header.over {
		background-color: rgba(229, 73, 58, 0.22);
	}

	.column-header.under {
		background-color: rgba(246, 194, 67, 0.18);
	}

	.column-title {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.4px;
		text-transform: uppercase;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.name {
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		flex: none;
		font-weight: 600;
	}

	.over-mark,
	.under-mark {
		flex: none;
	}

	.over-mark {
		color: #e5493a;
	}

	.under-mark {
		color: #f6c243;
	}
</style>
