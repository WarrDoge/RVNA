<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		title: string;
		active?: boolean;
		disabled?: boolean;
		onclick: () => void;
		children: Snippet;
	}

	let {
		title,
		active = false,
		disabled = false,
		onclick,
		children,
	}: Props = $props();
</script>

<button
	type="button"
	{title}
	aria-label={title}
	aria-pressed={active}
	{disabled}
	class="wke-tool{active ? ' is-active' : ''}"
	onmousedown={(event) => event.preventDefault()}
	{onclick}
>
	{@render children()}
</button>
