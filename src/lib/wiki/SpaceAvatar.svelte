<script lang="ts">
	interface Props {
		name: string;
		iconPath: string | null;
		size?: number;
	}

	let { name, iconPath, size = 28 }: Props = $props();

	let initials = $derived(
		name
			.split(/\s+/)
			.filter(Boolean)
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase() || "SP",
	);
</script>

{#if iconPath?.startsWith("http")}
	<img src={iconPath} alt="" width={size} height={size} class="icon" />
{:else}
	<span
		class="wiki-space-avatar"
		aria-hidden="true"
		style="width: {size}px; height: {size}px; font-size: {Math.round(
			size * 0.38,
		)}px;"
	>
		{initials}
	</span>
{/if}

<style>
	.icon {
		border-radius: 4px;
		flex: none;
	}
</style>
