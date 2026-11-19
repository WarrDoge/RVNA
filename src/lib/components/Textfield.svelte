<!--
	The CSS of this component is adapted from the package @atlaskit/textfield.
	Copyright 2019 Atlassian Pty Ltd. Licensed under the Apache License, Version 2.0; see LICENSE and NOTICE.
	Changed for RVNA.
-->
<script lang="ts">
	interface Props {
		id?: string;
		value?: string;
		placeholder?: string;
		type?: string;
		min?: number;
		autoFocus?: boolean;
		isDisabled?: boolean;
		oninput?: (event: Event & { currentTarget: HTMLInputElement }) => void;
		onchange?: (event: Event & { currentTarget: HTMLInputElement }) => void;
		[key: string]: unknown;
	}

	let {
		id,
		value = $bindable(""),
		placeholder,
		type,
		min,
		autoFocus = false,
		isDisabled = false,
		oninput,
		onchange,
		...rest
	}: Props = $props();
</script>

<div
	role="presentation"
	data-ds--text-field--container="true"
	data-disabled={isDisabled ? "true" : undefined}
	class="textfield {isDisabled ? 'disabled' : ''}"
>
	<!-- svelte-ignore a11y_autofocus -->
	<input
		{id}
		data-ds--text-field--input="true"
		{placeholder}
		{type}
		{min}
		autofocus={autoFocus || undefined}
		disabled={isDisabled}
		class="textfield-input"
		bind:value
		{oninput}
		{onchange}
		{...rest}
	/>
</div>

<style>
	.textfield {
		display: flex;
		flex-grow: 1;
		flex-shrink: 1;
		flex-basis: 100%;
		align-items: center;
		justify-content: space-between;
		box-sizing: border-box;
		overflow: hidden;
		max-width: 100%;
		padding-block: var(--ds-border-width, 1px);
		padding-inline: 0;
		border: var(--ds-border-width, 1px) solid var(--ds-border-input, #8c8f97);
		border-radius: var(--ds-radius-medium, 6px);
		background-color: var(--ds-background-input, #fff);
		color: var(--ds-text, #292a2e);
		font: var(
			--ds-font-body,
			normal 400 14px/20px "Inter", ui-sans-serif, -apple-system,
			BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif
		);
		vertical-align: top;
		word-wrap: break-word;
		pointer-events: auto;
		cursor: text;
		transition:
			background-color 0.2s ease-in-out,
			border-color 0.2s ease-in-out;
	}

	.textfield:hover {
		border-color: var(--ds-border-input, #8c8f97);
		background-color: var(--ds-background-input-hovered, #f8f8f8);
	}

	.textfield:focus-within {
		border-color: var(--ds-border-focused, #4688ec);
		background-color: var(--ds-background-input-pressed, #fff);
		box-shadow: inset 0 0 0 var(--ds-border-width, 1px)
			var(--ds-border-focused, #4688ec);
	}

	.textfield.disabled {
		border-color: var(--ds-background-disabled, #0515240f);
		background-color: var(--ds-background-disabled, #0515240f);
		color: var(--ds-text-disabled, #080f214a);
		cursor: not-allowed;
	}

	.textfield-input {
		width: 100%;
		min-width: 0;
		border: 0;
		padding: var(--ds-space-100, 8px) var(--ds-space-075, 6px);
		background-color: transparent;
		color: inherit;
		font: var(
			--ds-font-body,
			normal 400 14px/20px "Inter", ui-sans-serif, -apple-system,
			BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif
		);
		outline: medium none currentColor;
		box-shadow: none;
		cursor: inherit;
	}

	.textfield-input:placeholder-shown {
		text-overflow: ellipsis;
	}

	.textfield-input::placeholder {
		color: var(--ds-text-subtlest, #6b6e76);
	}

	.textfield.disabled .textfield-input::placeholder {
		color: var(--ds-text-disabled, #080f214a);
	}
</style>
