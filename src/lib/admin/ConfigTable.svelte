<script lang="ts">
	import type { Snippet } from "svelte";
	import type { ConfigColumn } from "./config.ts";

	let {
		columns,
		children,
	}: { columns: ConfigColumn[]; children: Snippet } = $props();
</script>

<table class="fat-table config-table">
	<thead>
		<tr>
			{#each columns as column, index (index)}
				<th style:width={column.width === undefined
					? undefined
					: `${column.width}px`}>{column.label}</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		{@render children()}
	</tbody>
</table>

<style>
	.config-table {
		width: 100%;
	}
</style>
