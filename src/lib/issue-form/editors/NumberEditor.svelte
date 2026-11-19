<script lang="ts">
	import type { CustomFieldSpec } from "#lib/api-types.ts";
	import { untrack } from "svelte";
	import { inputStyle } from "../styles.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
		autoFocus?: boolean;
	}

	let { field, value, onChange, autoFocus = false }: Props = $props();

	let text = $state(
		untrack(() => (typeof value === "number" ? String(value) : "")),
	);
</script>

<!-- svelte-ignore a11y_autofocus -->
<input
	aria-label={field.name}
	autofocus={autoFocus}
	type="number"
	value={text}
	oninput={(event) => {
		const next = event.currentTarget.value;
		text = next;
		if (next.trim() === "") {
			onChange(null);
			return;
		}
		const parsed = Number(next);
		onChange(Number.isFinite(parsed) ? parsed : null);
	}}
	style={inputStyle}
/>
