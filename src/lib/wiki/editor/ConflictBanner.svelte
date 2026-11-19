<script lang="ts">
	import Banner from "./Banner.svelte";

	interface Props {
		currentVersion: number | null;
		viewHref: string;
	}

	let { currentVersion, viewHref }: Props = $props();
</script>

{#snippet actions()}
	<a href={viewHref} target="_blank" rel="noreferrer">Open latest version</a>
{/snippet}

<Banner tone="danger" title="This page was changed while you were editing" {actions}>
	{currentVersion === null
		? "A newer version exists."
		: `Version ${currentVersion} was published by someone else.`}{" "}
	Your changes are kept as a draft; copy them over from the latest version.
</Banner>
