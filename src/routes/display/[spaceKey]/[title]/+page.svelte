<script lang="ts">
	import "#lib/wiki/wiki.css";
	import PageMessage from "#lib/wiki/PageMessage.svelte";
	import PageView from "#lib/wiki/PageView.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

{#if data.page}
	{#key data.page.id}
		<PageView
			page={data.page}
			tree={data.tree}
			canEdit={data.canEdit}
			canDelete={data.canDelete}
		/>
	{/key}
{:else if data.missing}
	<PageMessage title={data.missing.title} message={data.missing.message} />
{/if}
