<script lang="ts">
	import type { Snippet } from "svelte";
	import Icon from "#lib/components/Icon.svelte";

	interface Props {
		title: string;
		label: Snippet;
		disabled?: boolean;
		active?: boolean;
		wide?: boolean;
		menu: Snippet<[() => void]>;
	}

	let {
		title,
		label,
		disabled = false,
		active = false,
		wide = false,
		menu,
	}: Props = $props();

	let open = $state(false);
	let wrap: HTMLDivElement;

	function close() {
		open = false;
	}

	$effect(() => {
		if (!open) return;
		function onMouseDown(event: MouseEvent) {
			if (wrap && !wrap.contains(event.target as Node)) open = false;
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			open = false;
		}
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	});
</script>

<div class="wke-menu-wrap" bind:this={wrap}>
	<button
		type="button"
		{title}
		aria-label={title}
		aria-haspopup="menu"
		aria-expanded={open}
		{disabled}
		class="wke-tool wke-tool-menu{active || open ? ' is-active' : ''}"
		onmousedown={(event) => event.preventDefault()}
		onclick={() => (open = !open)}
	>
		{@render label()}
		<Icon name="chevron-down" size={10} />
	</button>
	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="wke-menu{wide ? ' is-wide' : ''}"
			role="menu"
			tabindex="-1"
			onmousedown={(event) => event.preventDefault()}
		>
			{@render menu(close)}
		</div>
	{/if}
</div>
