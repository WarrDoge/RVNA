<script lang="ts">
	import { page } from "$app/state";
	import { onMount, type Snippet } from "svelte";
	import type { BoardRef } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import ProjectSidebar from "#lib/project/ProjectSidebar.svelte";
	import type { ProjectSidebarData } from "#lib/project/types.ts";
	import { rememberBoard } from "#lib/recent-boards.ts";

	interface Props {
		board: BoardRef;
		sidebar: ProjectSidebarData;
		active: "board" | "backlog" | "reports" | "releases";
		children: Snippet;
	}

	let { board, sidebar, active, children }: Props = $props();

	let menuOpen = $state(false);
	let fullscreen = $state(false);
	let menuTrigger: HTMLElement | undefined = $state();
	let menu: HTMLDivElement | undefined = $state();

	$effect(() => {
		rememberBoard(page.data.user?.id ?? "", {
			rapidViewId: board.rapidViewId,
			name: board.name,
			type: board.type,
			projectKey: board.project?.key ?? null,
		});
	});

	function toggleFullscreen() {
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			void document.documentElement.requestFullscreen();
		}
	}

	$effect(() => {
		if (!menuOpen) return;
		menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	});

	function closeMenu() {
		menuOpen = false;
		menuTrigger?.querySelector<HTMLElement>("button")?.focus();
	}

	function onMenuKeyDown(event: KeyboardEvent) {
		const items = [
			...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
		];
		if (items.length === 0) return;
		const index = items.indexOf(document.activeElement as HTMLElement);
		if (event.key === "Escape") {
			event.preventDefault();
			closeMenu();
			return;
		}
		if (event.key === "Home") {
			event.preventDefault();
			items[0].focus();
			return;
		}
		if (event.key === "End") {
			event.preventDefault();
			items[items.length - 1].focus();
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const next =
			event.key === "ArrowDown"
				? (index + 1 + items.length) % items.length
				: (index - 1 + items.length) % items.length;
		items[next].focus();
	}

	onMount(() => {
		const update = () => {
			fullscreen = Boolean(document.fullscreenElement);
		};
		update();
		document.addEventListener("fullscreenchange", update);
		return () => document.removeEventListener("fullscreenchange", update);
	});
</script>

<PageTitle title={board.name} />

<div class="board-shell">
	<ProjectSidebar data={sidebar} {active} {board} />
	<div
		class="board-content"
		style:--board-header-actions-right={active === "board" ? "120px" : undefined}
	>
		{#if active === "board" || active === "backlog"}
			<div class="board-actions">
				<div
					class="board-menu"
					{@attach dismiss(
						() => menuOpen,
						() => (menuOpen = false),
					)}
				>
					<span class="menu-trigger" bind:this={menuTrigger}>
						<Button
							spacing="compact"
							aria-expanded={menuOpen}
							aria-haspopup="menu"
							aria-controls="board-menu"
							onclick={() => (menuOpen = !menuOpen)}
						>
							Board <Icon name="chevron-down" />
						</Button>
					</span>
					{#if menuOpen}
						<div
							class="menu"
							id="board-menu"
							role="menu"
							aria-label="Board"
							tabindex="-1"
							bind:this={menu}
							onkeydown={onMenuKeyDown}
						>
							<a
								class="fat-menu-item"
								role="menuitem"
								href={`/secure/RapidView.jspa?rapidView=${board.rapidViewId}&tab=columns`}
								onclick={() => (menuOpen = false)}
							>
								Configure
							</a>
							<a
								class="fat-menu-item"
								role="menuitem"
								href={board.project
									? `/secure/ManageRapidViews.jspa?project=${board.project.key}`
									: "/secure/ManageRapidViews.jspa"}
								onclick={() => (menuOpen = false)}
							>
								Create board
							</a>
							<a
								class="fat-menu-item"
								role="menuitem"
								href="/secure/ManageRapidViews.jspa"
								onclick={() => (menuOpen = false)}
							>
								View all boards
							</a>
						</div>
					{/if}
				</div>
				<button
					type="button"
					class="fullscreen"
					title={fullscreen ? "Exit full screen" : "Enter full screen"}
					aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}
					onclick={toggleFullscreen}
				>
					<svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
						<path
							d={fullscreen
								? "M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"
								: "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"}
							fill="none"
							stroke="currentColor"
							stroke-width={1.5}
						/>
					</svg>
				</button>
			</div>
		{/if}
		{@render children()}
	</div>
</div>

<style>
	.board-shell {
		display: flex;
		min-height: calc(100vh - 56px);
	}

	.board-content {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
	}

	.board-actions {
		position: absolute;
		top: 30px;
		right: 16px;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.board-content:has(> :global(aside)) .board-actions {
		right: calc(480px + 17px);
	}

	.board-menu {
		position: relative;
	}

	.menu-trigger {
		display: inline-flex;
	}

	.menu {
		position: absolute;
		top: 32px;
		right: 0;
		z-index: 120;
		min-width: 190px;
		padding: 4px;
		background-color: var(--ds-surface-overlay, #2b2c2f);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay, 0 8px 12px #0000005c);
	}

	.fullscreen {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		height: 24px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 13px;
		cursor: pointer;
	}

	.fullscreen:hover {
		background-color: var(--ds-background-neutral-subtle-hovered, #ceced912);
	}
</style>
