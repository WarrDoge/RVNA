<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { inputStyle, popupStyle } from "./styles.ts";
	import { dismiss } from "#lib/components/dismiss.ts";

	interface Props {
		label: string;
		options: { id: string; name: string }[];
		selected: string[];
		onChange: (ids: string[]) => void;
	}

	let { label, options, selected, onChange }: Props = $props();

	let open = $state(false);

	let names = $derived(
		selected
			.map((id) => options.find((option) => option.id === id)?.name)
			.filter((name): name is string => Boolean(name)),
	);


	function toggle(id: string) {
		onChange(
			selected.includes(id)
				? selected.filter((item) => item !== id)
				: [...selected, id],
		);
	}

	const buttonStyle = `${inputStyle} display: flex; align-items: center; gap: 6px; text-align: left; cursor: pointer;`;
	const valueStyle = (present: boolean) =>
		`flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${present ? token("color.text") : token("color.text.subtlest")};`;
	const optionStyle = `display: flex; align-items: center; gap: 8px; padding: 6px 8px; color: ${token(
		"color.text",
	)}; cursor: pointer;`;
	const emptyStyle = `padding: 6px; color: ${token("color.text.subtle")};`;
</script>

<div {@attach dismiss(() => open, () => (open = false))} style="position: relative;">
	<button
		type="button"
		aria-label={label}
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
		<div style={popupStyle}>
			{#if options.length === 0}
				<div style={emptyStyle}>Nothing to choose.</div>
			{/if}
			{#each options as option (option.id)}
				<label style={optionStyle}>
					<input
						type="checkbox"
						checked={selected.includes(option.id)}
						onchange={() => toggle(option.id)}
					/>
					{option.name}
				</label>
			{/each}
		</div>
	{/if}
</div>
