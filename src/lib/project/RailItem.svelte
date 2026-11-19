<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		href: string;
		label: string;
		active: boolean;
		icon: Snippet;
	}

	let { href, label, active, icon }: Props = $props();
</script>

<a
	href={href}
	title={label}
	aria-label={label}
	aria-current={active ? "page" : undefined}
	class="fat-sidebar-item"
>
	{@render icon()}
</a>

<style>
	.fat-sidebar-item {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 3px;
		background-color: transparent;
		color: var(--ds-text-subtle, #a9abaf);
		text-decoration: none;
	}

	.fat-sidebar-item[aria-current="page"] {
		background-color: var(--ds-background-selected, #1c2b41);
		color: var(--ds-text-selected, #669df1);
	}

	.fat-sidebar-item[aria-current="page"]:hover {
		background-color: var(--ds-background-selected, #1c2b41);
	}
</style>
