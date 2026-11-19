<script lang="ts">
	import type { CustomFieldSpec } from "#lib/api-types.ts";
	import { inputStyle } from "../styles.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
		autoFocus?: boolean;
		withTime?: boolean;
	}

	let {
		field,
		value,
		onChange,
		autoFocus = false,
		withTime = false,
	}: Props = $props();

	function pad(value: number) {
		return String(value).padStart(2, "0");
	}

	function toLocalInput(value: unknown) {
		if (typeof value !== "string" || value === "") return "";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "";
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function fromLocalInput(value: string) {
		if (value === "") return null;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}

	let shown = $derived(
		withTime
			? toLocalInput(value)
			: typeof value === "string"
				? value
				: "",
	);
	const style = `${inputStyle} max-width: 260px;`;
</script>

<!-- svelte-ignore a11y_autofocus -->
<input
	aria-label={field.name}
	autofocus={autoFocus}
	type={withTime ? "datetime-local" : "date"}
	value={shown}
	oninput={(event) => {
		const next = event.currentTarget.value;
		onChange(withTime ? fromLocalInput(next) : next || null);
	}}
	{style}
/>
