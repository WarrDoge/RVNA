<script lang="ts">
	import { type Snippet, tick } from "svelte";
	import Icon from "#lib/components/Icon.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import ToolbarButton from "./ToolbarButton.svelte";

	interface Props {
		label: string;
		children: Snippet;
	}

	let { label, children }: Props = $props();
	const menuId = $props.id();
	let open = $state(false);
	let menu = $state<HTMLDivElement>();

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			menu
				?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
				?.focus();
		});
	});
</script>

<div
	class="root"
	{@attach dismiss(
		() => open,
		() => (open = false),
	)}
>
	<ToolbarButton
		onclick={() => (open = !open)}
		expanded={open}
		haspopup="menu"
		controls={menuId}
	>
		{label}
		<Icon name="chevron-down" size={12} />
	</ToolbarButton>
	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={menu}
			id={menuId}
			role="menu"
			tabindex="-1"
			aria-label={label}
			class="menu"
			onclick={() => (open = false)}
			onkeydown={(event) => {
				if (event.key === "Escape") open = false;
			}}
		>
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.root {
		position: relative;
	}

	.menu {
		position: absolute;
		top: 34px;
		left: 0;
		z-index: 100;
		min-width: 190px;
		padding: 4px;
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay);
	}
</style>
