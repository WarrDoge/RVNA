<script lang="ts">
	import { untrack } from "svelte";
	import { hydratingPage } from "#lib/hydration.ts";
	import type { EstimationField } from "#lib/api-types.ts";
	import { estimationOptions } from "#lib/boards/reports.ts";

	interface Props {
		value: EstimationField;
		onChange: (value: EstimationField) => void;
	}

	let { value, onChange }: Props = $props();

	let selected = $state<string | undefined>(
		hydratingPage() ? undefined : untrack(() => value),
	);
	let loadedValue = untrack(() => value);
	$effect(() => {
		if (value === loadedValue) return;
		loadedValue = value;
		selected = value;
	});
</script>

<label class="control">
	<span class="label">Estimation</span>
	<select
		aria-label="Estimation statistic"
		bind:value={selected}
		onchange={() => onChange(selected as EstimationField)}
	>
		{#each estimationOptions as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
</label>

<style>
	.control {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.label {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
	}

	select {
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input, #1d2125);
		border: 1px solid var(--ds-border-input, #738496);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		font-size: 14px;
	}
</style>
