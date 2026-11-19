<script lang="ts">
	import type { CustomFieldColumn } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import { SYSTEM_FIELDS } from "#lib/shared/fields.ts";

	interface Props {
		columns: string[];
		customFields: CustomFieldColumn[];
		onChange: (columns: string[]) => void;
	}

	let { columns, customFields, onChange }: Props = $props();

	let open = $state(false);

	let all = $derived([
		...SYSTEM_FIELDS.map((field) => ({ id: field.id, name: field.name })),
		...customFields.map((field) => ({ id: field.id, name: field.name })),
	]);

	function toggle(id: string) {
		const checked = columns.includes(id);
		const next = checked
			? columns.filter((item) => item !== id)
			: all
					.map((item) => item.id)
					.filter((item) => item === id || columns.includes(item));
		if (next.length > 0) onChange(next);
	}
</script>

<div class="root" {@attach dismiss(() => open, () => (open = false))}>
	<button
		type="button"
		aria-haspopup="dialog"
		aria-expanded={open}
		onclick={() => (open = !open)}
		class="header-button"
	>
		<Icon name="columns" size={14} /> Columns <Icon name="chevron-down" />
	</button>
	{#if open}
		<div role="dialog" aria-label="Columns" class="menu">
			{#each all as field (field.id)}
				<label class="row">
					<input
						type="checkbox"
						checked={columns.includes(field.id)}
						onchange={() => toggle(field.id)}
					/>
					{field.name}
				</label>
			{/each}
		</div>
	{/if}
</div>

<style>
	.root {
		position: relative;
	}

	.header-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 14px;
		cursor: pointer;
	}

	.menu {
		position: absolute;
		right: 0;
		top: 34px;
		z-index: 100;
		width: 240px;
		max-height: 320px;
		overflow-y: auto;
		padding: 8px;
		background-color: var(--ds-surface-overlay, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay, 0 8px 12px #1e1f2126);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		font-size: 14px;
		cursor: pointer;
	}
</style>
