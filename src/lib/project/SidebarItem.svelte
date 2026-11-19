<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		href: string;
		active: boolean;
		icon: Snippet;
		label: string;
	}

	let { href, active, icon, label }: Props = $props();
</script>

<a
	href={href}
	class="fat-sidebar-item"
	aria-current={active ? "page" : undefined}
>
	<span class="icon">{@render icon()}</span>
	<span class="label">{label}</span>
</a>

<style>
	.fat-sidebar-item {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 7px;
		border-radius: 3px;
		font-size: 14px;
		line-height: 20px;
		color: var(--ds-text-subtle, #a9abaf);
		text-decoration: none;
		background-color: transparent;
		font-weight: 400;
	}

	.fat-sidebar-item[aria-current="page"] {
		background-color: var(--ds-background-selected, #1c2b41);
		color: var(--ds-text-selected, #669df1);
		font-weight: 500;
	}

	.fat-sidebar-item[aria-current="page"]:hover {
		background-color: var(--ds-background-selected, #1c2b41);
	}

	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex: none;
	}

	.label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
