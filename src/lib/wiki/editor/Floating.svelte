<script lang="ts">
	import { untrack } from "svelte";
	import type { Snippet } from "svelte";

	export type Anchor = { left: number; top: number; bottom: number };

	interface Props {
		anchor: Anchor;
		className?: string;
		children: Snippet;
	}

	let { anchor, className = "", children }: Props = $props();

	let element = $state<HTMLDivElement>();
	let positionStyle = $state(
		untrack(() => `left: ${anchor.left}px; top: ${anchor.bottom + 4}px;`),
	);

	$effect(() => {
		const box = element?.getBoundingClientRect();
		const height = box?.height ?? 0;
		const width = box?.width ?? 0;
		const below = anchor.bottom + 4;
		const fits = below + height <= window.innerHeight - 8;
		positionStyle = `left: ${Math.max(
			8,
			Math.min(anchor.left, window.innerWidth - width - 8),
		)}px; top: ${fits ? below : Math.max(8, anchor.top - height - 4)}px;`;
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={element}
	class="wke-floating {className}"
	style={positionStyle}
	onmousedown={(event) => {
		if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
	}}
>
	{@render children()}
</div>
