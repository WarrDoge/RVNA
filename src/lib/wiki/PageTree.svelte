<script lang="ts">
	import type { PageRef } from "./types.ts";
	import TreeNode from "./TreeNode.svelte";

	interface Props {
		tree: PageRef[];
		spaceKey: string;
		currentId: string | null;
		ancestorIds: string[];
	}

	let { tree, spaceKey, currentId, ancestorIds }: Props = $props();
</script>

{#if tree.length === 0}
	<p class="wiki-list-empty">No pages yet.</p>
{:else}
	<div>
		{#each tree as node (node.id)}
			<TreeNode {node} {spaceKey} {currentId} {ancestorIds} depth={0} />
		{/each}
	</div>
{/if}
