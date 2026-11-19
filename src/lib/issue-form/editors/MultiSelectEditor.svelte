<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { CustomFieldOption, CustomFieldSpec } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import {
		optionsOf,
		visibleOptions,
	} from "../custom-field-values.ts";
	import { inputStyle, menuItemStyle, menuStyle, noneStyle } from "../styles.ts";
	import { dismiss } from "#lib/components/dismiss.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
	}

	let { field, value, onChange }: Props = $props();

	let open = $state(false);

	let selected = $derived(optionsOf(value));
	let options = $derived(
		selected.reduce(
			(list, item) => visibleOptions(list, item),
			visibleOptions(field.options, null),
		),
	);
	let names = $derived(selected.map((item) => item.value));


	function toggle(option: CustomFieldOption) {
		const present = selected.some(
			(item) => item.id === option.id || item.value === option.value,
		);
		const next = present
			? selected.filter(
					(item) => item.id !== option.id && item.value !== option.value,
				)
			: [...selected, { id: option.id, value: option.value }];
		onChange(next.length === 0 ? null : next);
	}

	function checked(option: CustomFieldOption) {
		return selected.some(
			(item) => item.id === option.id || item.value === option.value,
		);
	}

	const buttonStyle = `${inputStyle} display: flex; align-items: center; gap: 6px; text-align: left; cursor: pointer;`;
	const valueStyle = (present: boolean) =>
		`flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${present ? token("color.text") : token("color.text.subtlest")};`;
	const labelStyle = `${menuItemStyle} cursor: pointer;`;
	const disabledStyle = `${noneStyle} font-size: 12px;`;
	const emptyStyle = `padding: 6px; ${noneStyle}`;
</script>

<div {@attach dismiss(() => open, () => (open = false))} style="position: relative;">
	<button
		type="button"
		aria-label={field.name}
		aria-expanded={open}
		onclick={() => (open = !open)}
		style={buttonStyle}
	>
		<span style={valueStyle(names.length > 0)}
			>{names.length > 0 ? names.join(", ") : "None"}</span
		>
		<Icon name="chevron-down" />
	</button>
	{#if open}
		<div style={menuStyle}>
			{#each options as option (option.id)}
				<label style={labelStyle}>
					<input
						type="checkbox"
						checked={checked(option)}
						onchange={() => toggle(option)}
					/>
					{option.value}
					{#if option.disabled}
						<span style={disabledStyle}>(disabled)</span>
					{/if}
				</label>
			{/each}
			{#if options.length === 0}
				<div style={emptyStyle}>This field has no options yet.</div>
			{/if}
		</div>
	{/if}
</div>
