<script lang="ts">
	import { untrack } from "svelte";
	import Icon from "#lib/components/Icon.svelte";
	import {
		ancestorIds,
		searchNodes,
		type TreeNode,
		visibleRows,
	} from "./helpers.ts";

	interface Props {
		nodes: TreeNode[];
		spaceName: string;
		selectedId: string | null;
		onselect: (id: string | null) => void;
	}

	let { nodes, spaceName, selectedId, onselect }: Props = $props();

	let expanded = $state(
		untrack(() => new Set(ancestorIds(nodes, selectedId))),
	);
	let search = $state("");
	let box = $state<HTMLFieldSetElement>();

	let rows = $derived(visibleRows(nodes, expanded));
	let matches = $derived(searchNodes(nodes, search));
	let searching = $derived(search.trim() !== "");

	$effect(() => {
		const selected = selectedId;
		const current = rows;
		if (!box || (selected === null && current.length === 0)) return;
		box
			.querySelector('[data-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	});

	function toggle(id: string) {
		const next = new Set(expanded);
		if (!next.delete(id)) next.add(id);
		expanded = next;
	}
</script>

<input
	class="wed-input"
	aria-label="Search for a parent page"
	placeholder="Search for a parent page"
	bind:value={search}
/>
<fieldset bind:this={box} class="wed-tree" aria-label="Parent page">
	{#if searching}
		{#each matches as { node, path } (node.id)}
			<div class="wed-tree-row" data-selected={selectedId === node.id}>
				<button
					type="button"
					class="wed-tree-pick tree-pick-root"
					aria-current={selectedId === node.id}
					onclick={() => onselect(node.id)}
				>
					{node.title}
					{#if path}<span class="wed-tree-path"> {path}</span>{/if}
				</button>
			</div>
		{/each}
		{#if matches.length === 0}
			<p class="wed-hint tree-hint">No pages match.</p>
		{/if}
	{:else}
		<div class="wed-tree-row" data-selected={selectedId === null}>
			<button
				type="button"
				class="wed-tree-pick tree-pick-root"
				aria-current={selectedId === null}
				onclick={() => onselect(null)}
			>
				{spaceName} (top level)
			</button>
		</div>
		{#each rows as { node, depth, hasChildren, expanded: open } (node.id)}
			<div
				class="wed-tree-row"
				data-selected={selectedId === node.id}
				style="padding-left: {8 + depth * 16}px"
			>
				{#if hasChildren}
					<button
						type="button"
						class="wed-tree-toggle"
						aria-label={open ? `Collapse ${node.title}` : `Expand ${node.title}`}
						onclick={() => toggle(node.id)}
					>
						<Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
					</button>
				{:else}
					<span class="tree-spacer"></span>
				{/if}
				<button
					type="button"
					class="wed-tree-pick"
					aria-current={selectedId === node.id}
					onclick={() => onselect(node.id)}
				>
					{node.title}
				</button>
			</div>
		{/each}
	{/if}
</fieldset>

<style>
	.tree-hint {
		padding: 4px 12px;
	}
	.tree-spacer {
		width: 20px;
		flex: none;
	}
	.tree-pick-root {
		padding-left: 12px;
	}
</style>
