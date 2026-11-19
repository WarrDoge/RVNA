<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		boardName: string;
		title: string;
		children?: Snippet;
	}

	let { boardName, title, children }: Props = $props();
</script>

<div class="report-header">
	<div class="board-name">{boardName}</div>
	<div class="title-row">
		<h1>{title}</h1>
		{#if children}
			<div class="controls">{@render children()}</div>
		{/if}
	</div>
</div>

<style>
	.report-header {
		margin-bottom: 16px;
	}

	.board-name {
		font-size: 12px;
		line-height: 16px;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text, #cecfd2);
	}

	.controls {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
</style>
