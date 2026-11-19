<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import EditorPage from "#lib/wiki/editor/EditorPage.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title="Resume draft" />

{#if data.editor}
	{#key data.editor.context.page.id}
		<EditorPage
			context={data.editor.context}
			restrictions={data.editor.restrictions}
			spaces={data.editor.spaces}
			tree={data.editor.tree}
			me={data.editor.me}
			mode="resume"
		/>
	{/key}
{:else}
	<p class="wed-narrow">No draft given.</p>
{/if}
