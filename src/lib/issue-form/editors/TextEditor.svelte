<script lang="ts">
	import type { CustomFieldSpec } from "#lib/api-types.ts";
	import { inputStyle } from "../styles.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
		multiline?: boolean;
		autoFocus?: boolean;
	}

	let { field, value, onChange, multiline = false, autoFocus = false }: Props =
		$props();

	let text = $derived(typeof value === "string" ? value : "");
	const multilineStyle = `${inputStyle} height: auto; min-height: 84px; padding: 6px 8px; resize: vertical;`;
</script>

{#if multiline}
	<!-- svelte-ignore a11y_autofocus -->
	<textarea
		aria-label={field.name}
		autofocus={autoFocus}
		rows={4}
		value={text}
		oninput={(event) => onChange(event.currentTarget.value || null)}
		style={multilineStyle}
	></textarea>
{:else}
	<!-- svelte-ignore a11y_autofocus -->
	<input
		aria-label={field.name}
		autofocus={autoFocus}
		value={text}
		maxlength={255}
		oninput={(event) => onChange(event.currentTarget.value || null)}
		style={inputStyle}
	/>
{/if}
