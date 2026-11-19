<script lang="ts">
	import {
		detailLabelStyle,
		detailValueStyle,
	} from "#lib/issue-form/styles.ts";
	import type { DetailPair } from "./types.ts";

	interface Props {
		pairs: (DetailPair | undefined)[];
	}

	let { pairs }: Props = $props();
</script>

{#each pairs as pair, index (index)}
	{@const value = pair?.value}
	<div style={detailLabelStyle}>{pair?.label}</div>
	<div style={detailValueStyle} data-testid={pair?.testId}>
		{#if typeof value === "string"}
			{value}
		{:else if value}
			{@render value()}
		{/if}
	</div>
{/each}
