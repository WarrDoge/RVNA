<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import RemovePageForm from "#lib/wiki/editor/RemovePageForm.svelte";
	import type { ActionData, PageData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<PageTitle title="Delete page" />

{#if data.remove}
	<RemovePageForm
		page={data.remove.page}
		spaceName={data.remove.spaceName}
		canDelete={data.remove.canDelete}
		{form}
	/>
{:else}
	<p class="wed-narrow">No page given.</p>
{/if}
