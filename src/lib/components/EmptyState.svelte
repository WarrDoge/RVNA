<!--
	The CSS of this component is adapted from the package @atlaskit/empty-state.
	Copyright 2019 Atlassian Pty Ltd. Licensed under the Apache License, Version 2.0; see LICENSE and NOTICE.
	Changed for RVNA.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		header: string;
		description?: string;
		primaryAction?: Snippet;
		[key: string]: unknown;
	}

	let { header, description, primaryAction, ...rest }: Props = $props();
</script>

<div class="empty-state" {...rest}>
	<div class="empty-state-header">
		<h4 class="empty-state-title">{header}</h4>
	</div>
	{#if description}
		<div class="empty-state-description">
			<p class="empty-state-text">{description}</p>
		</div>
	{/if}
	{#if primaryAction}
		<div class="empty-state-actions">
			{@render primaryAction()}
			<div class="empty-state-spacer"></div>
		</div>
	{/if}
</div>

<style>
	.empty-state {
		margin-block: var(--ds-space-600, 3pc);
		margin-inline: auto;
		max-width: 29pc;
		text-align: center;
	}

	.empty-state-header,
	.empty-state-description {
		box-sizing: border-box;
		border: 0;
		appearance: none;
	}

	.empty-state-header {
		padding-block-end: var(--ds-space-200, 1pc);
	}

	.empty-state-title {
		margin: 0;
		letter-spacing: normal;
		text-transform: none;
		color: var(--ds-text, #292a2e);
		font: var(
			--ds-font-heading-medium,
			normal 653 20px/24px "Inter", ui-sans-serif, -apple-system,
			BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif
		);
	}

	.empty-state-description {
		padding-block-end: var(--ds-space-300, 24px);
	}

	.empty-state-text {
		margin: 0;
		overflow-wrap: anywhere;
		color: var(--ds-text, #292a2e);
		font: var(
			--ds-font-body,
			normal 400 14px/20px "Inter", ui-sans-serif, -apple-system,
			BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif
		);
	}

	.empty-state-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-block-end: var(--ds-space-100, 8px);
		padding-inline-start: var(--ds-space-500, 40px);
	}

	.empty-state-spacer {
		width: var(--ds-space-300, 24px);
		margin-inline-start: var(--ds-space-200, 1pc);
	}
</style>
