<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		onclick: () => void;
		active?: boolean;
		disabled?: boolean;
		hint?: string;
		children: Snippet;
	}

	let {
		onclick,
		active = false,
		disabled = false,
		hint,
		children,
	}: Props = $props();
</script>

<button
	type="button"
	role="menuitem"
	{disabled}
	class="wke-menu-item{active ? ' is-active' : ''}"
	onmousedown={(event) => event.preventDefault()}
	{onclick}
>
	<span>{@render children()}</span>
	{#if hint}<span class="wke-menu-hint">{hint}</span>{/if}
</button>
