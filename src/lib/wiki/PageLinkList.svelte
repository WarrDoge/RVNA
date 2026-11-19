<script lang="ts">
	import { formatRelative, pageHref } from "./format.ts";

	interface Props {
		pages: {
			id: string;
			sourceId: string;
			title: string;
			spaceName?: string;
			updated?: string | null;
			author?: string | null;
		}[];
		empty: string;
	}

	let { pages, empty }: Props = $props();
</script>

{#if pages.length === 0}
	<p class="wiki-list-empty">{empty}</p>
{:else}
	<ul class="wiki-list">
		{#each pages as page (page.id)}
			<li class="wiki-list-item">
				<a href={pageHref(page)}>{page.title}</a>
				{#if page.spaceName}
					<span class="wiki-list-space">{page.spaceName}</span>
				{/if}
				{#if page.updated}
					<span class="wiki-list-date">
						{formatRelative(page.updated)}
						{page.author ? ` by ${page.author}` : ""}
					</span>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
