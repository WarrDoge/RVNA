<script lang="ts">
	import type { Snippet } from "svelte";
	import ProjectSidebar from "./ProjectSidebar.svelte";
	import type {
		ProjectSidebarBoard,
		ProjectSidebarData,
		SidebarActive,
	} from "./types.ts";

	interface Props {
		data: ProjectSidebarData;
		active: SidebarActive;
		board?: ProjectSidebarBoard;
		children: Snippet;
	}

	let { data, active, board, children }: Props = $props();
</script>

<div class="project-frame">
	<ProjectSidebar {data} {active} {board} />
	<div class="project-content">{@render children()}</div>
</div>

<style>
	.project-frame {
		display: flex;
		min-height: calc(100vh - 56px);
	}

	.project-content {
		flex: 1;
		min-width: 0;
	}
</style>
