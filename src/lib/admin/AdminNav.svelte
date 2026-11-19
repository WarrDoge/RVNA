<script lang="ts">
	import { page } from "$app/state";
	import { adminNavigation } from "./navigation.ts";

	function isActive(
		pathname: string,
		href: string,
		match: readonly string[] = [],
	) {
		const path = href.split("?")[0] ?? href;
		return (
			pathname === path ||
			pathname === `${path}/` ||
			match.some((prefix) => pathname.startsWith(prefix))
		);
	}
</script>

<nav class="admin-nav" aria-label="Administration">
	{#each adminNavigation as section (section.heading)}
		<div class="admin-nav-section">
			<div class="admin-nav-heading">{section.heading}</div>
			{#each section.items as item (item.href)}
				{@const active = isActive(
					page.url.pathname,
					item.href,
					"match" in item ? item.match : [],
				)}
				<a
					class="fat-menu-item"
					class:active
					href={item.href}
					aria-current={active ? "page" : undefined}
				>
					{item.label}
				</a>
			{/each}
		</div>
	{/each}
</nav>

<style>
	.admin-nav {
		width: 240px;
		flex: none;
		padding: 16px 0;
		background-color: var(--ds-surface-sunken);
		border-right: 1px solid var(--ds-border);
	}

	.admin-nav a {
		padding: 6px 20px;
		border-left: 3px solid transparent;
		color: var(--ds-text);
		font-weight: 400;
	}

	.admin-nav a.active {
		border-left-color: var(--ds-border-selected);
		background-color: var(--ds-background-selected);
		color: var(--ds-text-selected);
		font-weight: 500;
	}

	.admin-nav-section {
		margin-bottom: 16px;
	}

	.admin-nav-heading {
		padding: 4px 20px;
		font-size: 11px;
		font-weight: 700;
		line-height: 16px;
		text-transform: uppercase;
		color: var(--ds-text-subtle);
	}
</style>
