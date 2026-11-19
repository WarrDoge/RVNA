<script lang="ts">
	interface Props {
		label: string;
		value: string[];
		options: string[];
		onChange: (value: string[]) => void;
		none?: string;
		extra?: { label: string; value: string }[];
	}

	let {
		label,
		value,
		options,
		onChange,
		none = "Any",
		extra,
	}: Props = $props();

	let current = $derived(value[0] ?? "");
</script>

<label class="picker">
	<span class="label">{label}</span>
	<select
		aria-label={label}
		value={current}
		onchange={(event) =>
			onChange(
				event.currentTarget.value === "" ? [] : [event.currentTarget.value],
			)}
		class="control"
	>
		<option value="">{none}</option>
		{#if current !== "" && !options.includes(current) && !(extra ?? []).some((item) => item.value === current)}
			<option value={current}>{current}</option>
		{/if}
		{#each extra ?? [] as item (item.value)}
			<option value={item.value}>{item.label}</option>
		{/each}
		{#each options as option (option)}
			<option value={option}>{option}</option>
		{/each}
	</select>
</label>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.label {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
		line-height: 16px;
	}

	.control {
		height: 32px;
		padding: 0 8px;
		background: var(--ds-background-input, #ffffff);
		border: 1px solid var(--ds-border-input, #8c8f97);
		border-radius: 3px;
		color: var(--ds-text, #292a2e);
		font-size: 14px;
		max-width: 200px;
	}
</style>
