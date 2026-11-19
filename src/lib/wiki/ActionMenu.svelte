<script lang="ts">
	import { dismiss } from "#lib/components/dismiss.ts";
	import type { PageDetail } from "./types.ts";

	interface Props {
		page: PageDetail;
		canEdit?: boolean;
		canDelete?: boolean;
		onInformation: () => void;
	}

	let {
		page,
		canEdit = false,
		canDelete = false,
		onInformation,
	}: Props = $props();

	let open = $state(false);
	let trigger = $state<HTMLButtonElement>();
	let menu = $state<HTMLDivElement>();

	function close() {
		open = false;
	}

	$effect(() => {
		if (!open) return;
		menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	});

	function onTriggerKeydown(event: KeyboardEvent) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			open = true;
		}
	}

	function onMenuKeydown(event: KeyboardEvent) {
		const items = [
			...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
		];
		const index = items.indexOf(document.activeElement as HTMLElement);
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			trigger?.focus();
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			items[(index + 1) % items.length]?.focus();
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			items[(index - 1 + items.length) % items.length]?.focus();
		} else if (event.key === "Home") {
			event.preventDefault();
			items[0]?.focus();
		} else if (event.key === "End") {
			event.preventDefault();
			items[items.length - 1]?.focus();
		}
	}

	type Item = { label: string; href?: string; onClick?: () => void };

	let items = $derived<Item[]>([
		{
			label: "Attachments",
			href: `/pages/viewpageattachments.action?pageId=${encodeURIComponent(page.sourceId)}`,
		},
		{
			label: "Page history",
			href: `/pages/viewpreviousversions.action?pageId=${encodeURIComponent(page.sourceId)}`,
		},
		{ label: "Page information", onClick: onInformation },
		{ label: "Export to PDF", onClick: () => window.print() },
		...(canEdit
			? [
					{
						label: "Copy",
						href: `/pages/copypage.action?idOfPageToCopy=${encodeURIComponent(page.sourceId)}`,
					},
					{
						label: "Move",
						href: `/pages/movepage.action?pageId=${encodeURIComponent(page.sourceId)}`,
					},
				]
			: []),
		...(canDelete
			? [
					{
						label: "Delete",
						href: `/pages/removepage.action?pageId=${encodeURIComponent(page.sourceId)}`,
					},
				]
			: []),
	]);
</script>

<div
	class="menu-root"
	{@attach dismiss(() => open, () => {
		open = false;
	})}
>
	<button
		bind:this={trigger}
		type="button"
		class="wiki-action"
		aria-label="More actions"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
		onkeydown={onTriggerKeydown}
	>
		•••
	</button>
	{#if open}
		<div
			bind:this={menu}
			class="wiki-menu"
			role="menu"
			tabindex="-1"
			aria-label="More actions"
			onkeydown={onMenuKeydown}
		>
			{#each items as item (item.label)}
				{#if item.href}
					<a
						class="fat-menu-item"
						role="menuitem"
						href={item.href}
						onclick={close}
					>
						{item.label}
					</a>
				{:else}
					<button
						class="fat-menu-item"
						role="menuitem"
						type="button"
						onclick={() => {
							close();
							item.onClick?.();
						}}
					>
						{item.label}
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.menu-root {
		position: relative;
	}
</style>
