<script lang="ts">
	import { untrack } from "svelte";
	import { api } from "#lib/api.ts";
	import type { EditorSpace } from "#lib/shared/wiki/index.ts";
	import { errorMessage } from "./edit-session.svelte.ts";
	import {
		descendantIds,
		type Location,
		locationSpaceOptions,
		type TreeNode,
	} from "./helpers.ts";
	import PageTree from "./PageTree.svelte";


	interface Props {
		value: Location;
		onchange: (value: Location) => void;
		spaces: EditorSpace[];
		initialTree?: TreeNode[];
		excludeId?: string;
		ontree?: (nodes: TreeNode[]) => void;
		/** Only offer spaces where the caller may create a page. */
		requireCreate?: boolean;
	}

	let {
		value,
		onchange,
		spaces,
		initialTree,
		excludeId,
		ontree,
		requireCreate = false,
	}: Props = $props();

	let cache = $state<Record<string, TreeNode[]>>(
		untrack(() => (initialTree ? { [value.spaceKey]: initialTree } : {})),
	);
	let tree = $state.raw<TreeNode[] | null>(
		untrack(() => initialTree ?? null),
	);
	let treeError = $state<string | null>(null);

	$effect(() => {
		const key = value.spaceKey;
		const cached = cache[key];
		if (cached) {
			tree = cached;
			treeError = null;
			ontree?.(cached);
			return;
		}
		let cancelled = false;
		tree = null;
		api<TreeNode[]>(
			`/api/wiki/edit/space-tree/${encodeURIComponent(key)}`,
		).then(
			(nodes) => {
				if (cancelled) return;
				cache = { ...cache, [key]: nodes };
				tree = nodes;
				treeError = null;
				ontree?.(nodes);
			},
			(error) => {
				if (!cancelled) treeError = errorMessage(error);
			},
		);
		return () => {
			cancelled = true;
		};
	});

	let nodes = $derived.by(() => {
		if (!tree) return null;
		if (!excludeId) return tree;
		const hidden = descendantIds(tree, excludeId);
		return tree.filter((node) => !hidden.has(node.id));
	});

	let options = $derived(
		locationSpaceOptions(spaces, value.spaceKey, requireCreate),
	);
	let spaceName = $derived(
		options.find((space) => space.key === value.spaceKey)?.name ??
			value.spaceKey,
	);
</script>

<div class="wed-field">
	<label class="wed-label" for="wed-space">Space</label>
	<select
		id="wed-space"
		class="wed-input"
		bind:value={() => value.spaceKey, (spaceKey) =>
			onchange({ spaceKey, parentId: null })}
	>
		{#if options.length === 0}
			{#if requireCreate}
				<option value="" disabled>No space where you can create pages</option>
			{:else}
				<option value={value.spaceKey}>{value.spaceKey}</option>
			{/if}
		{/if}
		{#each options as space (space.key)}
			<option value={space.key}>{space.name} ({space.key})</option>
		{/each}
	</select>
</div>
<span class="wed-label">Parent page</span>
{#if treeError}<p class="wed-error">{treeError}</p>{/if}
{#if nodes}
	{#key value.spaceKey}
		<PageTree
			{nodes}
			{spaceName}
			selectedId={value.parentId}
			onselect={(parentId) => onchange({ spaceKey: value.spaceKey, parentId })}
		/>
	{/key}
{:else}
	<div class="wed-tree" aria-busy="true"></div>
{/if}
