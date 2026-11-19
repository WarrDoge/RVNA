<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import TrashView from "#lib/wiki/editor/TrashView.svelte";
	import type { ActionData, PageData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<PageTitle title="Trash" />

{#if data.trash}
	<TrashView
		spaceKey={data.trash.spaceKey}
		entries={data.trash.entries}
		spaces={data.trash.spaces}
		canRestore={data.trash.canRestore}
		canPurge={data.trash.canPurge}
		{form}
	/>
{:else}
	<p class="wed-narrow">No space given.</p>
{/if}
