<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { CustomFieldOption, CustomFieldSpec } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { untrack } from "svelte";
	import { optionOf, visibleOptions } from "../custom-field-values.ts";
	import { inputStyle, menuItemStyle, menuStyle, noneStyle } from "../styles.ts";
	import { dismiss } from "#lib/components/dismiss.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
		autoFocus?: boolean;
	}

	let { field, value, onChange, autoFocus = false }: Props = $props();

	let open = $state(untrack(() => autoFocus ?? false));

	let selected = $derived(optionOf(value));
	let options = $derived(visibleOptions(field.options, selected));


	function choose(option: CustomFieldOption | null) {
		onChange(option ? { id: option.id, value: option.value } : null);
		open = false;
	}

	const buttonStyle = `${inputStyle} display: flex; align-items: center; gap: 6px; text-align: left; cursor: pointer;`;
	const valueStyle = (present: boolean) =>
		`flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${present ? token("color.text") : token("color.text.subtlest")};`;
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
		<span style={valueStyle(Boolean(selected))}>{selected?.value ?? "None"}</span>
		<Icon name="chevron-down" />
	</button>
	{#if open}
		<div role="listbox" aria-label={`${field.name} options`} style={menuStyle}>
			<button
				type="button"
				role="option"
				aria-selected={!selected}
				onclick={() => choose(null)}
				style={menuItemStyle}
			>
				None
			</button>
			{#each options as option (option.id)}
				<button
					type="button"
					role="option"
					aria-selected={selected?.id === option.id ||
						selected?.value === option.value}
					onclick={() => choose(option)}
					style={menuItemStyle}
				>
					{option.value}
					{#if option.disabled}
						<span style={disabledStyle}>(disabled)</span>
					{/if}
				</button>
			{/each}
			{#if options.length === 0}
				<div style={emptyStyle}>This field has no options yet.</div>
			{/if}
		</div>
	{/if}
</div>
