<!--
	The CSS of this component is adapted from the package @atlaskit/lozenge.
	Copyright 2019 Atlassian Pty Ltd. Licensed under the Apache License, Version 2.0; see LICENSE and NOTICE.
	Changed for RVNA.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	type Appearance =
		| "default"
		| "success"
		| "moved"
		| "new"
		| "removed"
		| "inprogress";

	interface Props {
		appearance?: Appearance;
		children: Snippet;
		[key: string]: unknown;
	}

	let { appearance = "default", children, ...rest }: Props = $props();
</script>

<span
	class="lozenge {appearance === 'default' ? '' : appearance}"
	style="max-width: min(200px, 100%);"
	{...rest}
>
	<span class="lozenge-content">
		<span class="lozenge-text" style="max-width: calc(200px - var(--ds-space-100, 8px));"
			>{@render children()}</span
		>
	</span>
</span>

<style>
	.lozenge {
		--lozenge-border-color: var(--ds-border, #0b120e24);
		display: inline-flex;
		position: relative;
		align-items: center;
		box-sizing: border-box;
		height: 1.25rem;
		padding-block: var(--ds-space-025, 2px);
		padding-inline: var(--ds-space-050, 4px);
		border-width: var(--ds-border-width, 1px);
		border-style: solid;
		border-color: var(--lozenge-border-color);
		border-radius: var(--ds-radius-small, 4px);
		overflow: hidden;
		max-width: 100%;
		background-color: var(--ds-background-neutral, #0515240f);
		color: var(--ds-text, #292a2e);
	}

	.lozenge.success {
		--lozenge-border-color: var(--ds-border-success-subtle, #b3df72);
		background-color: var(--ds-background-success-subtler, #d3f1a7);
		color: var(--ds-text-success-bolder, #37471f);
	}

	.lozenge.moved {
		--lozenge-border-color: var(--ds-border-warning-subtle, #fbc828);
		background-color: var(--ds-background-warning-subtler, #fce4a6);
		color: var(--ds-text-warning-bolder, #693200);
	}

	.lozenge.new {
		--lozenge-border-color: var(--ds-border-discovery-subtle, #d8a0f7);
		background-color: var(--ds-background-discovery-subtler, #eed7fc);
		color: var(--ds-text-discovery-bolder, #48245d);
	}

	.lozenge.removed {
		--lozenge-border-color: var(--ds-border-danger-subtle, #fd9891);
		background-color: var(--ds-background-danger-subtler, #ffd5d2);
		color: var(--ds-text-danger-bolder, #5d1f1a);
	}

	.lozenge.inprogress {
		--lozenge-border-color: var(--ds-border-information-subtle, #8fb8f6);
		background-color: var(--ds-background-information-subtler, #cfe1fd);
		color: var(--ds-text-information-bolder, #123263);
	}

	.lozenge-content {
		display: inline-flex;
		align-items: center;
		gap: var(--ds-space-050, 4px);
		max-width: 100%;
	}

	.lozenge-text {
		font: var(
			--ds-font-body-small,
			normal 400 9pt/1pc "Inter", ui-sans-serif, -apple-system,
			BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif
		);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
</style>
