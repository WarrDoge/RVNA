<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
		onclick: () => void;
		danger?: boolean;
		disabled?: boolean;
	}

	let { children, onclick, danger = false, disabled = false }: Props = $props();
</script>

<button
	type="button"
	role="menuitem"
	class="fat-menu-item"
	class:danger
	{disabled}
	{onclick}
>
	{@render children()}
</button>

<style>
	.danger {
		color: #e5493a;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
