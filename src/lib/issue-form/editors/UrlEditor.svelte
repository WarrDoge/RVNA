<script lang="ts">
	import type { CustomFieldSpec } from "#lib/api-types.ts";
	import { inputStyle } from "../styles.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
		autoFocus?: boolean;
	}

	let { field, value, onChange, autoFocus = false }: Props = $props();
</script>

<!-- svelte-ignore a11y_autofocus -->
<input
	aria-label={field.name}
	autofocus={autoFocus}
	value={typeof value === "string" ? value : ""}
	placeholder="https://"
	oninput={(event) => onChange(event.currentTarget.value || null)}
	style={inputStyle}
/>
