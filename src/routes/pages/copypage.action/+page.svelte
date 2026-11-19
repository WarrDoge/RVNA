<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import CopyPageForm from "#lib/wiki/editor/CopyPageForm.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title="Copy page" />

{#if data.copy}
	{#key data.copy.page.id}
		<CopyPageForm
			page={data.copy.page}
			spaces={data.copy.spaces}
			tree={data.copy.tree}
		/>
	{/key}
{:else}
	<p class="wed-narrow">No page given.</p>
{/if}
