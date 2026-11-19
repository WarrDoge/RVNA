<script lang="ts">
	import { untrack } from "svelte";
	import Icon from "#lib/components/Icon.svelte";
	import { pageChildren } from "./api.ts";
	import { pageTitleHref } from "./format.ts";
	import type { PageRef } from "./types.ts";
	import Self from "./TreeNode.svelte";

	interface Props {
		node: PageRef;
		spaceKey: string;
		currentId: string | null;
		ancestorIds: string[];
		depth: number;
	}

	let { node, spaceKey, currentId, ancestorIds, depth }: Props = $props();

	let expanded = $state(
		untrack(() => ancestorIds.includes(node.id)),
	);
	let children = $state<PageRef[] | null>(null);
	let loaded = $state(false);
	let link = $state<HTMLAnchorElement>();

	$effect(() => {
		if (ancestorIds.includes(node.id) || node.id === currentId) {
			expanded = true;
		}
	});

	$effect(() => {
		if (!expanded || !node.hasChildren || loaded) return;
		let cancelled = false;
		pageChildren(node.id)
			.then((rows) => {
				if (cancelled) return;
				children = rows;
				loaded = true;
			})
			.catch(() => {
				if (!cancelled) loaded = true;
			});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (node.id === currentId) {
			link?.scrollIntoView({ block: "nearest" });
		}
	});
</script>

<div>
	<div class="wiki-tree-node" style="padding-left: {depth * 12}px">
		{#if node.hasChildren}
			<button
				type="button"
				class="wiki-tree-toggle"
				aria-label={expanded
					? `Collapse ${node.title}`
					: `Expand ${node.title}`}
				aria-expanded={expanded}
				onclick={() => (expanded = !expanded)}
				style="transform: {expanded ? 'none' : 'rotate(-90deg)'}"
			>
				<Icon name="chevron-down" size={10} />
			</button>
		{:else}
			<span class="wiki-tree-toggle" aria-hidden="true"></span>
		{/if}
		<a
			bind:this={link}
			class="wiki-tree-link"
			class:is-current={node.id === currentId}
			href={pageTitleHref(spaceKey, node.title)}
			aria-current={node.id === currentId ? "page" : undefined}
			title={node.title}
		>
			{node.title}
		</a>
	</div>
	{#if expanded}
		{#each children ?? [] as child (child.id)}
			<Self
				node={child}
				{spaceKey}
				{currentId}
				{ancestorIds}
				depth={depth + 1}
			/>
		{/each}
	{/if}
</div>
