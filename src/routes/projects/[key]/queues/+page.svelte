<script lang="ts">
	import NotFound from "#lib/components/NotFound.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title="Queues" />

{#if data.empty}
	<NotFound />
{/if}
