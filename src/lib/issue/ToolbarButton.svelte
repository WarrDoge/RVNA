<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
		onclick?: () => void;
		title?: string;
		disabled?: boolean;
		expanded?: boolean;
		haspopup?: "menu" | "dialog";
		controls?: string;
	}

	let {
		children,
		onclick,
		title,
		disabled = false,
		expanded,
		haspopup,
		controls,
	}: Props = $props();
</script>

<button
	type="button"
	{title}
	{disabled}
	aria-expanded={expanded}
	aria-haspopup={haspopup}
	aria-controls={controls}
	onclick={onclick}
	class="toolbar-button"
>
	{@render children()}
</button>

<style>
	.toolbar-button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 30px;
		padding: 0 10px;
		background-color: var(--ds-background-neutral);
		color: var(--ds-text);
		border: 0;
		border-radius: 3px;
		font-size: 14px;
		font-weight: 500;
		line-height: 20px;
		cursor: pointer;
	}

	.toolbar-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
