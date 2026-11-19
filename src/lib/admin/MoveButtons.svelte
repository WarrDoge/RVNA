<script lang="ts">
	let {
		index,
		count,
		onMove,
		label,
	}: {
		index: number;
		count: number;
		onMove: (delta: -1 | 1) => void;
		label: string;
	} = $props();
</script>

<span class="move-buttons">
	<span class="move-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
	<button
		type="button"
		class="move-button"
		aria-label={`Move ${label} up`}
		disabled={index === 0}
		onclick={() => onMove(-1)}
	>
		↑
	</button>
	<button
		type="button"
		class="move-button"
		aria-label={`Move ${label} down`}
		disabled={index === count - 1}
		onclick={() => onMove(1)}
	>
		↓
	</button>
</span>

<style>
	.move-buttons {
		display: inline-flex;
		align-items: center;
	}

	.move-handle {
		cursor: grab;
		color: var(--ds-text-subtle);
	}

	.move-button {
		padding: 0 4px;
		background: transparent;
		border: 0;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}
</style>
