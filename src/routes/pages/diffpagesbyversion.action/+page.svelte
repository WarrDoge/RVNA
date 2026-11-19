<script lang="ts">
	import "#lib/wiki/wiki.css";
	import PageMessage from "#lib/wiki/PageMessage.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import WikiLayout from "#lib/wiki/WikiLayout.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let changed = $derived(
		(data.diff?.blocks ?? []).filter((block) => block.type === "change")
			.length,
	);
</script>

{#if !data.page}
	<PageMessage
		title="Page not found"
		message="This page does not exist, or you do not have permission to view it."
		back={false}
	/>
{:else if data.from === null || data.to === null}
	<PageTitle title={data.page.title} />
	<section class="message">
		<h1>Compare versions</h1>
		<p>Select two versions on the page history screen.</p>
	</section>
{:else}
	<PageTitle title={data.page.title} />
	<WikiLayout
		space={data.page.space}
		tree={data.tree}
		currentPageId={data.page.id}
		contextPageId={data.page.sourceId}
		ancestorIds={data.page.ancestors.map((ancestor) => ancestor.id)}
	>
		<div class="wiki-crumbs">
			<a href={`/display/${encodeURIComponent(data.page.space.key)}`}>
				{data.page.space.name}
			</a>
			<span>/</span>
			<a href={`/pages/viewpage.action?pageId=${data.page.sourceId}`}>
				{data.page.title}
			</a>
			<span>/</span>
			<span>Compare versions</span>
		</div>
		<h1 class="wiki-page-title">
			Comparing versions {data.from} and {data.to}
		</h1>
		{#if !data.diff}
			<p>Unable to compare these versions.</p>
		{:else}
			<div class="wiki-diff-page">
				<div class="wiki-diff-header">
					<span>
						Version {data.from} → version {data.to}: {changed} changed block{changed ===
					1
						? ""
						: "s"}
					</span>
					<span class="inserted">inserted</span>
					<span class="removed">removed</span>
				</div>
				{#each data.diff.blocks as block, index (index)}
					<div class="wiki-diff-block">{@html block.html}</div>
				{/each}
			</div>
		{/if}
	</WikiLayout>
{/if}

<style>
	.message {
		padding: 40px 32px;
	}

	.message h1 {
		margin: 0 0 8px;
		font-size: 24px;
		font-weight: 500;
	}

	.inserted {
		color: #7ee2b8;
	}

	.removed {
		color: #ff9c8f;
	}
</style>
