<script lang="ts">
	import type { CustomFieldSpec } from "#lib/api-types.ts";
	import { cascadingOf, visibleOptions } from "../custom-field-values.ts";
	import { inputStyle } from "../styles.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
	}

	let { field, value, onChange }: Props = $props();

	let current = $derived(cascadingOf(value));
	let parents = $derived(visibleOptions(field.options, current));
	let parent = $derived(
		parents.find(
			(option) =>
				option.id === current?.id ||
				(current?.id === undefined && option.value === current?.value),
		),
	);
	let children = $derived(
		parent ? visibleOptions(parent.children, current?.child ?? null) : [],
	);
	const style = inputStyle;
</script>

<div style="display: flex; gap: 8px;">
	<select
		aria-label={field.name}
		value={parent?.id ?? ""}
		onchange={(event) => {
			const next = field.options.find(
				(option) => option.id === event.currentTarget.value,
			);
			onChange(next ? { id: next.id, value: next.value } : null);
		}}
		style={style}
	>
		<option value="">None</option>
		{#each parents as option (option.id)}
			<option value={option.id}>{option.value}</option>
		{/each}
	</select>
	<select
		aria-label={`${field.name} child`}
		value={current?.child?.id ?? ""}
		disabled={children.length === 0}
		onchange={(event) => {
			if (!parent) return;
			const next = children.find(
				(option) => option.id === event.currentTarget.value,
			);
			onChange({
				id: parent.id,
				value: parent.value,
				...(next ? { child: { id: next.id, value: next.value } } : {}),
			});
		}}
		style={style}
	>
		<option value="">None</option>
		{#each children as option (option.id)}
			<option value={option.id}>{option.value}</option>
		{/each}
	</select>
</div>
