<script lang="ts">
	import { token } from "#lib/tokens.ts";

	interface Props {
		name: string;
		avatarUrl: string | null;
		size?: number;
	}

	let { name, avatarUrl, size = 40 }: Props = $props();

	let initials = $derived(
		name
			.split(/\s+/)
			.filter(Boolean)
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase() || "?",
	);
	let style = $derived(
		`width: ${size}px; height: ${size}px; border-radius: 3px; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; flex: none; background-color: ${token(
			"color.background.brand.bold",
		)}; color: ${token("color.text.inverse")}; font-size: ${Math.round(
			size * 0.4,
		)}px; font-weight: 600; line-height: 1;`,
	);
</script>

<span aria-hidden="true" style={style}>
	{#if avatarUrl}
		<img
			src={avatarUrl}
			alt=""
			style="width: 100%; height: 100%; object-fit: cover;"
		/>
	{:else}
		{initials}
	{/if}
</span>
