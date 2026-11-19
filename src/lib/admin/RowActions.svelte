<script lang="ts">
	let {
		label,
		onEdit,
		onDelete,
	}: {
		label: string;
		onEdit: () => void;
		onDelete: () => void;
	} = $props();
</script>

<span class="row-actions">
	<button
		type="button"
		class="row-action"
		aria-label={`Edit ${label}`}
		onclick={onEdit}
	>
		Edit
	</button>
	<span class="row-action-separator" aria-hidden="true">|</span>
	<button
		type="button"
		class="row-action"
		aria-label={`Delete ${label}`}
		onclick={onDelete}
	>
		Delete
	</button>
</span>

<style>
	.row-actions {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		white-space: nowrap;
	}

	.row-action {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link);
		font: inherit;
		cursor: pointer;
	}

	.row-action-separator {
		color: var(--ds-text-subtlest);
	}
</style>
