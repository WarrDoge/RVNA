<script lang="ts">
	import MissingBoard from "#lib/boards/MissingBoard.svelte";
	import BacklogPage from "./BacklogPage.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

{#if data.missing}
	<MissingBoard />
{:else}
	{#key data.backlog.board.rapidViewId}
		<BacklogPage {data} />
	{/key}
{/if}
