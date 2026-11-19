<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		label,
		children,
	}: { label: string; children: Snippet } = $props();
</script>

<tr>
	<th scope="row" class="term">{label}</th>
	<td class="value">{@render children()}</td>
</tr>

<style>
	.term {
		width: 180px;
		padding: 6px 12px 6px 0;
		vertical-align: top;
		color: var(--ds-text-subtle);
		font-size: 12px;
		font-weight: 600;
	}

	.value {
		padding: 6px 0;
		vertical-align: top;
		color: var(--ds-text);
	}
</style>
