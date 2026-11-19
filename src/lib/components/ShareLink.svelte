<script lang="ts">
	interface Props {
		url: string;
		copied?: boolean;
	}

	let { url, copied = false }: Props = $props();
</script>

<div class="share-link" role="status">
	{#if copied}
		Link copied
	{:else}
		<a href={url}>{url}</a>
	{/if}
</div>

<style>
	.share-link {
		display: inline-block;
		max-width: 100%;
		margin: 8px 0 0;
		padding: 6px 10px;
		border: 1px solid var(--ds-border, #45474b);
		border-radius: 3px;
		background-color: var(--ds-surface-overlay, #2c2e33);
		color: var(--ds-text-subtle, #a9abaf);
		overflow-wrap: anywhere;
	}

	.share-link a {
		color: var(--ds-link, #579dff);
	}
</style>
