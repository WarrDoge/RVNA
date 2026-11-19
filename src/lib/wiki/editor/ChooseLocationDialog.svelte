<script lang="ts">
	import { untrack } from "svelte";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { EditorSpace } from "#lib/shared/wiki/index.ts";
	import {
		type ChosenLocation,
		type Location,
		pathTo,
		type TreeNode,
	} from "./helpers.ts";
	import LocationPicker from "./LocationPicker.svelte";

	interface Props {
		initial: Location;
		spaces: EditorSpace[];
		initialTree: TreeNode[];
		onclose: () => void;
		onchoose: (location: ChosenLocation) => void;
	}

	let { initial, spaces, initialTree, onclose, onchoose }: Props = $props();

	let location = $state<Location>(untrack(() => initial));
	let tree = $state<TreeNode[]>(untrack(() => initialTree));

	function choose() {
		onchoose({
			...location,
			spaceName:
				spaces.find((space) => space.key === location.spaceKey)?.name ??
				location.spaceKey,
			path: pathTo(tree, location.parentId).map((node) => ({
				id: node.id,
				title: node.title,
			})),
		});
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		isDisabled={tree === null}
		onclick={choose}
	>
		Choose
	</Button>
	<Button appearance="subtle" onclick={onclose}>Cancel</Button>
{/snippet}

<Modal title="Choose a location" width={560} onClose={onclose} {footer}>
	<LocationPicker
		value={location}
		{spaces}
		{initialTree}
		ontree={(nodes) => (tree = nodes)}
		onchange={(next) => (location = next)}
	/>
</Modal>
