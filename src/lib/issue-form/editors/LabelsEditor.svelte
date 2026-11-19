<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { CustomFieldSpec } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { stringsOf } from "../custom-field-values.ts";
	import { chipStyle, inputStyle } from "../styles.ts";
	import { parseLabels } from "../types.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
	}

	let { field, value, onChange }: Props = $props();

	let labels = $derived(stringsOf(value));
	let draft = $state("");

	function add(text: string) {
		const next = [...labels];
		for (const label of parseLabels(text)) {
			if (!next.includes(label)) next.push(label);
		}
		if (next.length !== labels.length) onChange(next);
		draft = "";
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			add(draft);
		}
		if (event.key === "Backspace" && draft === "" && labels.length > 0) {
			const next = labels.slice(0, -1);
			onChange(next.length === 0 ? null : next);
		}
	}

	function remove(label: string) {
		const next = labels.filter((item) => item !== label);
		onChange(next.length === 0 ? null : next);
	}

	const chipsStyle =
		"display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;";
	const removeStyle = `display: inline-flex; padding: 0; background: transparent; border: 0; color: ${token(
		"color.text.subtle",
	)}; cursor: pointer;`;
</script>

<div>
	<input
		aria-label={field.name}
		placeholder="Add labels separated by spaces"
		value={draft}
		oninput={(event) => (draft = event.currentTarget.value)}
		onkeydown={onKeyDown}
		onblur={() => {
			if (draft.trim() !== "") add(draft);
		}}
		onpaste={(event) => {
			const text = event.clipboardData?.getData("text") ?? "";
			if (/[\n,]/.test(text)) {
				event.preventDefault();
				add(text);
			}
		}}
		style={inputStyle}
	/>
	{#if labels.length > 0}
		<div style={chipsStyle}>
			{#each labels as label (label)}
				<span style={chipStyle}>
					{label}
					<button
						type="button"
						aria-label={`Remove ${label}`}
						onclick={() => remove(label)}
						style={removeStyle}
					>
						<Icon name="close" size={10} />
					</button>
				</span>
			{/each}
		</div>
	{/if}
</div>
