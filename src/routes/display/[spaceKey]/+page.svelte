<script lang="ts">
	import "#lib/wiki/wiki.css";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import PageLinkList from "#lib/wiki/PageLinkList.svelte";
	import PageMessage from "#lib/wiki/PageMessage.svelte";
	import PageView from "#lib/wiki/PageView.svelte";
	import WikiLayout from "#lib/wiki/WikiLayout.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let description = $derived(
		data.space?.descriptionHtml
			? data.space.descriptionHtml.replace(/<[^>]*>/g, " ")
			: "No description.",
	);
</script>

{#if !data.space}
	<PageTitle title="Space not found" />
	<section class="message">
		<h1>Space not found</h1>
		<p class="text">
			This space does not exist, or you do not have permission to view it.
		</p>
		<p><a href="/spacedirectory/view.action">Back to the space directory</a></p>
	</section>
{:else if data.page}
	{#key data.page.id}
		<PageView
			page={data.page}
			tree={data.tree}
			canEdit={data.canEdit}
			canDelete={data.canDelete}
		/>
	{/key}
{:else if data.pageMissing}
	<PageMessage
		title="Page not found"
		message="This page does not exist, or you do not have permission to view it."
	/>
{:else}
	<PageTitle title={data.space.name} />
	<WikiLayout space={data.space} tree={data.tree}>
		<div class="wiki-crumbs">
			<a href="/wiki">Wiki</a>
			<span>/</span>
			<span>{data.space.name}</span>
		</div>
		<h1 class="wiki-page-title">{data.space.name}</h1>
		<p class="empty-space">This space has no home page yet.</p>
		<div class="wiki-card about">
			<h2>About this space</h2>
			<p class="about-text">{description}</p>
			<p class="about-meta">
				{data.space.pageCount} pages · {data.space.type} space
			</p>
		</div>
		<div class="pages">
			<h2>Pages</h2>
			<PageLinkList pages={data.tree} empty="No pages in this space yet." />
		</div>
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

	.text {
		color: var(--ds-text-subtle);
	}

	.empty-space {
		color: var(--ds-text-subtle);
	}

	.about {
		max-width: 560px;
		margin-top: 16px;
	}

	.about-text {
		margin: 0 0 8px;
	}

	.about-meta {
		margin: 0;
		color: var(--ds-text-subtle);
	}

	.pages {
		margin-top: 24px;
		max-width: 560px;
	}

	.pages h2 {
		font-size: 16px;
		font-weight: 600;
	}
</style>
