<script lang="ts">
	let {
		items,
	}: {
		items: { label: string; href?: string }[];
	} = $props();
</script>

<nav aria-label="Breadcrumb" class="breadcrumb">
	{#each items as item, index (item.label)}
		<span class="crumb">
			{#if index > 0}<span aria-hidden="true">/</span>{/if}
			{#if item.href}
				<a href={item.href}>{item.label}</a>
			{:else}
				<span aria-current={index === items.length - 1 ? "page" : undefined}>
					{item.label}
				</span>
			{/if}
		</span>
	{/each}
</nav>

<style>
	.breadcrumb {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 12px;
		color: var(--ds-text-subtle);
		margin-bottom: 8px;
	}

	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.crumb a {
		color: var(--ds-text-subtle);
		text-decoration: none;
	}
</style>
