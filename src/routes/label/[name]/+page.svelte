<script lang="ts">
	import "#lib/wiki/wiki.css";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import { formatDate, pageHref } from "#lib/wiki/format.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title={`Label: ${data.name}`} />

<section class="label-page">
	<h1>Label: {data.name}</h1>
	<p class="intro">Pages that carry this label.</p>
	{#if data.pages.length === 0}
		<p class="wiki-list-empty">No pages carry this label.</p>
	{/if}
	<ul class="wiki-list">
		{#each data.pages as page (page.id)}
			<li class="wiki-list-item">
				<a href={pageHref(page)}>{page.title}</a>
				<span class="wiki-list-space">{page.spaceName}</span>
				<span class="wiki-list-date">updated {formatDate(page.updated)}</span>
			</li>
		{/each}
	</ul>
</section>

<style>
	.label-page {
		padding: 24px 32px 48px;
		max-width: 900px;
	}

	h1 {
		margin: 0 0 4px;
		font-size: 24px;
		font-weight: 500;
	}

	.intro {
		color: var(--ds-text-subtle);
		margin: 0 0 12px;
	}
</style>
