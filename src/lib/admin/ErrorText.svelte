<script lang="ts">
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<div class="error-text" role="alert">{@render children()}</div>

<style>
	.error-text {
		margin-top: 4px;
		font-size: 12px;
		color: var(--ds-text-danger);
	}
</style>
