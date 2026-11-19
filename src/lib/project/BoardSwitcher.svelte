<script lang="ts">
	import { tick } from "svelte";
	import Icon from "#lib/components/Icon.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import type { ProjectSidebarBoard } from "./types.ts";

	interface Props {
		board: ProjectSidebarBoard;
		boards: ProjectSidebarBoard[];
	}

	let { board, boards }: Props = $props();
	let open = $state(false);
	let menu = $state<HTMLDivElement>();

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			menu?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
		});
	});

	function onMenuKeyDown(event: KeyboardEvent) {
		const items = [...(menu?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
		const index = items.indexOf(document.activeElement as HTMLElement);
		if (event.key === "ArrowDown") {
			event.preventDefault();
			items[(index + 1) % items.length]?.focus();
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			items[index <= 0 ? items.length - 1 : index - 1]?.focus();
		} else if (event.key === "Home") {
			event.preventDefault();
			items[0]?.focus();
		} else if (event.key === "End") {
			event.preventDefault();
			items[items.length - 1]?.focus();
		}
	}

	let options = $derived(
		boards.some((item) => item.rapidViewId === board.rapidViewId)
			? boards
			: [board, ...boards],
	);
</script>

<div
	class="board-switcher"
	{@attach dismiss(
		() => open,
		() => (open = false),
	)}
>
	<button
		type="button"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="name">{board.name}</span>
		<Icon name="chevron-down" />
	</button>
	{#if open}
		<div
			class="menu"
			role="menu"
			aria-label="Boards"
			tabindex="-1"
			bind:this={menu}
			onkeydown={onMenuKeyDown}
		>
			{#each options as item (item.id)}
				<a
					class="fat-menu-item"
					role="menuitem"
					href={`/secure/RapidBoard.jspa?rapidView=${item.rapidViewId}`}
					onclick={() => (open = false)}
					style:font-weight={item.rapidViewId === board.rapidViewId
						? 600
						: 400}
				>
					{item.name}
				</a>
			{/each}
			<a
				class="fat-menu-item"
				role="menuitem"
				href="/secure/ManageRapidViews.jspa"
				onclick={() => (open = false)}
			>
				View all boards
			</a>
		</div>
	{/if}
</div>

<style>
	.board-switcher {
		position: relative;
		margin-bottom: 10px;
	}

	button {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 8px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		font-size: 14px;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}

	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.menu {
		position: absolute;
		top: 34px;
		left: 0;
		right: 0;
		z-index: 120;
		padding: 4px;
		background-color: var(--ds-surface-overlay, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay, 0 8px 12px #0304048f);
	}
</style>
