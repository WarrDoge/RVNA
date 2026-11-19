<script lang="ts">
	interface Props {
		label: string;
		value: { from: string; to: string } | null;
		onChange: (value: { from: string; to: string } | null) => void;
	}

	let { label, value, onChange }: Props = $props();

	let current = $derived(value ?? { from: "", to: "" });
</script>

<div class="range">
	<span class="label">{label}</span>
	<div class="row">
		<input
			aria-label={`${label} from`}
			type="date"
			value={current.from}
			onchange={(event) =>
				onChange({ ...current, from: event.currentTarget.value })}
			class="control date"
		/>
		<span class="label">to</span>
		<input
			aria-label={`${label} to`}
			type="date"
			value={current.to}
			onchange={(event) =>
				onChange({ ...current, to: event.currentTarget.value })}
			class="control date"
		/>
	</div>
</div>

<style>
	.range {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.label {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
		line-height: 16px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 4px;
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

	.date {
		max-width: 140px;
	}
</style>
