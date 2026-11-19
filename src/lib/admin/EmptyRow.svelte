<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		columns,
		children,
	}: { columns: number; children: Snippet } = $props();
</script>

<tr>
	<td class="empty-row" colspan={columns}>{@render children()}</td>
</tr>

<style>
	.empty-row {
		padding: 24px;
		text-align: center;
		color: var(--ds-text-subtle);
	}
</style>
