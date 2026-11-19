<script lang="ts">
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";

	interface Props {
		names: string[];
		available: string[];
		disabled: boolean;
		onChange: (names: string[]) => void;
	}

	let { names, available, disabled, onChange }: Props = $props();

	function update(index: number, value: string) {
		const next = [...names];
		next[index] = value;
		onChange([...new Set(next)]);
	}
</script>

<div class="transitions">
	{#each names as name, index (name)}
		<div class="row">
			<select
				aria-label={`Transition ${index + 1}`}
				bind:value={() => name, (value) => update(index, value)}
				{disabled}
				style="{inputStyle} width: 260px;"
			>
				{#if !available.includes(name)}
					<option value={name}>{name}</option>
				{/if}
				{#each available as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
			<Button
				spacing="compact"
				isDisabled={disabled}
				onclick={() => onChange(names.filter((_, item) => item !== index))}
			>
				Remove
			</Button>
		</div>
	{/each}
	<div>
		<Button
			spacing="compact"
			isDisabled={disabled ||
				available.length === 0 ||
				available.every((option) => names.includes(option))}
			onclick={() => {
				const next = available.find((option) => !names.includes(option));
				if (next) onChange([...names, next]);
			}}
		>
			Add transition
		</Button>
	</div>
</div>

<style>
	.transitions {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.row {
		display: flex;
		gap: 8px;
	}
</style>
