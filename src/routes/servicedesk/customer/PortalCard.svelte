<script lang="ts">
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<div class="portal-card">
	{@render children()}
</div>

<style>
	.portal-card {
		background-color: var(--ds-surface-raised);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		padding: 24px 32px 32px;
	}
</style>
