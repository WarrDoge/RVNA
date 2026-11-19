<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import Button from "#lib/components/Button.svelte";

	interface Props {
		createAnother?: boolean;
		showCreateAnother?: boolean;
		submitLabel: string;
		pending: boolean;
		disabled: boolean;
		onSubmit: () => void;
		onCancel: () => void;
	}

	let {
		createAnother = $bindable(false),
		showCreateAnother = false,
		submitLabel,
		pending,
		disabled,
		onSubmit,
		onCancel,
	}: Props = $props();

	const rootStyle =
		"display: flex; align-items: center; gap: 8px; width: 100%;";
	const labelStyle = `display: flex; align-items: center; gap: 6px; color: ${token(
		"color.text",
	)};`;
	const actionsStyle = 'margin-left: auto; display: flex; gap: 8px;';
	const cancelStyle = `padding: 0 8px; background: transparent; border: 0; color: ${token(
		"color.link",
	)}; cursor: pointer; font-size: 14px;`;
</script>

<div style={rootStyle}>
	{#if showCreateAnother}
		<label style={labelStyle}>
			<input
				type="checkbox"
				checked={createAnother}
				onchange={(event) =>
					(createAnother = event.currentTarget.checked)}
			/>
			Create another
		</label>
	{/if}
	<div style={actionsStyle}>
		<Button
			appearance="primary"
			onclick={onSubmit}
			isLoading={pending}
			isDisabled={disabled}
		>
			{submitLabel}
		</Button>
		<button type="button" onclick={onCancel} style={cancelStyle}>Cancel</button>
	</div>
</div>
