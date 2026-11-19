<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import MovePageScreen from "#lib/wiki/editor/MovePageScreen.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title="Move page" />

{#if data.move}
	{#key data.move.page.id}
		<MovePageScreen
			page={data.move.page}
			spaceName={data.move.spaceName}
			breadcrumb={data.move.breadcrumb}
			spaces={data.move.spaces}
			tree={data.move.tree}
		/>
	{/key}
{:else}
	<p class="wed-narrow">No page given.</p>
{/if}
