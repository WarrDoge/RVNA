<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { parseLabels } from "./types.ts";
	import { chipStyle, inputStyle } from "./styles.ts";

	interface Props {
		value: string;
		onChange: (value: string) => void;
		label?: string;
		placeholder?: string;
	}

	let {
		value,
		onChange,
		label = "Labels",
		placeholder = "Add labels separated by spaces",
	}: Props = $props();

	let labels = $derived(parseLabels(value));
	const chipsStyle =
		"display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;";
	const removeStyle = `display: inline-flex; padding: 0; background: transparent; border: 0; color: ${token(
		"color.text.subtle",
	)}; cursor: pointer;`;
</script>

<div>
	<input
		aria-label={label}
		{placeholder}
		value={value}
		oninput={(event) => onChange(event.currentTarget.value)}
		style={inputStyle}
	/>
	{#if labels.length > 0}
		<div style={chipsStyle}>
			{#each labels as item (item)}
				<span style={chipStyle}>
					{item}
					<button
						type="button"
						aria-label={`Remove ${item}`}
						onclick={() =>
							onChange(labels.filter((label) => label !== item).join(" "))}
						style={removeStyle}
					>
						<Icon name="close" size={10} />
					</button>
				</span>
			{/each}
		</div>
	{/if}
</div>
