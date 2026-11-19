<script lang="ts">
	import { goto } from "$app/navigation";
		import type {
		EditorSpace,
		PageRef,
		SpaceTreeNode,
	} from "#lib/shared/wiki/index.ts";
	import MovePageDialog from "./MovePageDialog.svelte";
	import { viewPageUrl } from "./wiki-api.ts";
	import "./screens.css";

	interface Props {
		page: PageRef;
		spaceName: string;
		breadcrumb: { id: string; title: string }[];
		spaces: EditorSpace[];
		tree: SpaceTreeNode[];
	}

	let { page, spaceName, breadcrumb, spaces, tree }: Props = $props();

	const currentPath = $derived(
		[spaceName, ...breadcrumb.map((crumb) => crumb.title)].join(" / "),
	);

	function back() {
		void goto(viewPageUrl(page.id));
	}
</script>

<section class="wed-narrow">
	<h1 class="wed-heading">Move page</h1>
	<MovePageDialog
		{page}
		{currentPath}
		{spaces}
		initialTree={tree}
		cancelHref={viewPageUrl(page.id)}
		onclose={back}
		onmoved={(moved) => void goto(viewPageUrl(moved.id))}
	/>
</section>
