<script lang="ts">
	import { enhance } from "$app/forms";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import EditorPage from "#lib/wiki/editor/EditorPage.svelte";
	import type { ActionData, PageData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let starter = $state<HTMLFormElement>();
	let submittedKey = $state<string | null>(null);

	// The draft is created by this form action once the page is really open. A link that
	// is only hovered or tapped runs the load, never the action. Same-route navigation
	// reuses the component and clears `form`, so the effect keys on the load data.
	$effect(() => {
		const key = `${data.spaceKey ?? ""}:${data.parentId ?? ""}`;
		if (!data.spaceKey || submittedKey === key) return;
		submittedKey = key;
		starter?.requestSubmit();
	});
</script>

<PageTitle title="Create page" />

<form method="POST" use:enhance bind:this={starter} hidden></form>

{#if !data.spaceKey}
	<p class="wed-narrow">No space given.</p>
{:else if form && "error" in form}
	<div class="wed-narrow">
		<h1 class="wed-heading">Create page</h1>
		<p class="wed-error" role="alert">{form.error}</p>
	</div>
{:else if form}
	{#key form.editor.context.page.id}
		<EditorPage
			context={form.editor.context}
			restrictions={form.editor.restrictions}
			spaces={form.editor.spaces}
			tree={form.editor.tree}
			me={form.editor.me}
			mode="create"
		/>
	{/key}
{:else}
	<p class="wed-narrow" role="status">Preparing the editor…</p>
{/if}
