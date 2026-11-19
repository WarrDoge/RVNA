<script lang="ts">
	import type { Snippet } from "svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";

	interface Props {
		title: string;
		description?: string | Snippet;
		actions?: Snippet;
		breadcrumb?: Snippet;
		children: Snippet;
	}

	let { title, description, actions, breadcrumb, children }: Props = $props();
</script>

<PageTitle {title} />

<section class="admin-page">
	{#if breadcrumb}
		<div class="admin-breadcrumb">{@render breadcrumb()}</div>
	{/if}
	<div class="admin-title-row">
		<h1 class="admin-title">{title}</h1>
		{#if actions}
			<div class="admin-actions">{@render actions()}</div>
		{/if}
	</div>
	{#if description}
		<p class="admin-description">
			{#if typeof description === "string"}
				{description}
			{:else}
				{@render description()}
			{/if}
		</p>
	{/if}
	{@render children()}
</section>

<style>
	.admin-page {
		flex: 1;
		min-width: 0;
		padding: 24px 32px;
		overflow-x: auto;
	}

	.admin-breadcrumb {
		margin-bottom: 8px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}

	.admin-title-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}

	.admin-title {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	.admin-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.admin-description {
		margin: 0 0 16px;
		color: var(--ds-text-subtle);
	}
</style>
