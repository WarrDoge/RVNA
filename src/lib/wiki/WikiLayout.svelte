<script lang="ts">
	import { onMount, type Snippet } from "svelte";
	import Icon from "#lib/components/Icon.svelte";
	import { rememberSpace, setWikiContext } from "./context.ts";
	import PageTree from "./PageTree.svelte";
	import SpaceAvatar from "./SpaceAvatar.svelte";
	import type { PageRef } from "./types.ts";

	const SIDEBAR_WIDTH_KEY = "rvna.wiki.sidebarWidth";
	const SIDEBAR_COLLAPSED_KEY = "rvna.wiki.sidebarCollapsed";

	interface Props {
		space: { key: string; name: string; iconPath: string | null };
		tree: PageRef[];
		currentPageId?: string | null;
		/** The Confluence-style page id the Create button should carry. */
		contextPageId?: string | null;
		ancestorIds?: string[];
		children: Snippet;
	}

	let {
		space,
		tree,
		currentPageId = null,
		contextPageId = null,
		ancestorIds = [],
		children,
	}: Props = $props();

	let width = $state(260);
	let collapsed = $state(false);
	let dragging = false;

	function readWidth() {
		const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
		return Number.isFinite(stored) && stored >= 180 && stored <= 420
			? stored
			: 260;
	}

	onMount(() => {
		width = readWidth();
		collapsed =
			window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";

		function onMove(event: PointerEvent) {
			if (!dragging) return;
			const next = Math.min(Math.max(event.clientX, 180), 420);
			width = next;
			window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
		}
		function onUp() {
			dragging = false;
		}
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onUp);
		return () => {
			document.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerup", onUp);
			document.removeEventListener("pointercancel", onUp);
		};
	});

	function resizeBy(delta: number) {
		const next = Math.min(Math.max(width + delta, 180), 420);
		width = next;
		window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
	}

	$effect(() => {
		const key = space.key;
		rememberSpace(key);
		setWikiContext({ spaceKey: key, pageId: contextPageId });
	});
</script>

{#if collapsed}
	<div class="wiki-shell">
		<button
			type="button"
			aria-label="Expand sidebar"
			class="expand"
			onclick={() => {
				collapsed = false;
				window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0");
			}}
		>
			<Icon name="chevron-right" size={12} />
		</button>
		<main class="wiki-main">{@render children()}</main>
	</div>
{:else}
	<div class="wiki-shell">
		<aside class="wiki-sidebar" style="width: {width}px">
			<div class="wiki-sidebar-header">
				<SpaceAvatar
					name={space.name}
					iconPath={space.iconPath}
					size={32}
				/>
				<a
					class="wiki-sidebar-name"
					href={`/display/${encodeURIComponent(space.key)}`}
					title={space.name}
				>
					{space.name}
				</a>
			</div>
			<nav class="wiki-sidebar-nav" aria-label="Space shortcuts">
				<a
					class="wiki-sidebar-link"
					href={`/display/${encodeURIComponent(space.key)}`}
				>
					<Icon name="issues" size={14} />
					Pages
				</a>
			</nav>
			<div class="wiki-sidebar-section-title">Page tree</div>
			<div class="wiki-tree">
				<PageTree
					{tree}
					spaceKey={space.key}
					currentId={currentPageId}
					{ancestorIds}
				/>
			</div>
			<div class="wiki-sidebar-footer">
				<a
					href={`/spaces/${encodeURIComponent(space.key)}/overview#space-tools`}
					title="Space tools are not available yet"
				>
					Space tools
				</a>
				<button
					type="button"
					aria-label="Collapse sidebar"
					class="collapse"
					onclick={() => {
						collapsed = true;
						window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
					}}
				>
					«
				</button>
			</div>
		</aside>
		<button
			type="button"
			class="wiki-sidebar-resizer"
			aria-label="Resize sidebar"
			title="Drag or use the arrow keys to resize the sidebar"
			onpointerdown={() => {
				dragging = true;
			}}
			onkeydown={(event) => {
				if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
					event.preventDefault();
					resizeBy(event.key === "ArrowLeft" ? -10 : 10);
				}
			}}
		></button>
		<main class="wiki-main">{@render children()}</main>
	</div>
{/if}

<style>
	.wiki-sidebar-name {
		text-decoration: none;
	}

	.expand {
		width: 24px;
		border: 0;
		border-right: 1px solid var(--ds-border);
		background: var(--ds-surface-sunken);
		color: var(--ds-text-subtle);
		cursor: pointer;
	}

	.collapse {
		background: transparent;
		border: 0;
		color: var(--ds-text-subtle);
		cursor: pointer;
		padding: 0;
	}

	.wiki-sidebar-resizer {
		padding: 0;
		border: 0;
	}

	.wiki-sidebar-resizer:focus-visible {
		outline: 2px solid var(--ds-border-focused, #669df1);
		outline-offset: -2px;
	}
</style>
