<script lang="ts">
	import { page } from "$app/state";

	interface Props {
		/** The page part of the tab title; omitted means the site title alone. */
		title?: string;
	}

	let { title }: Props = $props();

	let full = $derived(
		title ? `${title} - ${page.data.site.title}` : page.data.site.title,
	);
</script>

<svelte:head>
	<title>{full}</title>
</svelte:head>
