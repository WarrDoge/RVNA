<script lang="ts">
	import { token } from "#lib/tokens.ts";

	interface Props {
		user: {
			displayName: string;
			username: string;
			avatarUrl: string | null;
		};
		size?: number;
	}

	let { user, size = 24 }: Props = $props();

	let initials = $derived(
		user.displayName
			.split(/\s+/)
			.filter(Boolean)
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase() || user.username.slice(0, 2).toUpperCase(),
	);
	let style = $derived(
		`width: ${size}px; height: ${size}px; border-radius: 50%; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; flex: none; background-color: ${token(
			"color.background.neutral.bold",
		)}; color: ${token("color.text.inverse")}; font-size: ${Math.round(
			size * 0.42,
		)}px; font-weight: 600; line-height: 1;`,
	);
</script>

<span aria-hidden="true" style={style}>
	{#if user.avatarUrl}
		<img
			src={user.avatarUrl}
			alt=""
			style="width: 100%; height: 100%; object-fit: cover;"
		/>
	{:else}
		{initials}
	{/if}
</span>
