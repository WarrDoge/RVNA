<script lang="ts">
	import Icon from "./Icon.svelte";
	import { type IconName, issueTypeIconKey } from "./icons.ts";

	interface Props {
		name: string;
		size?: number;
		icon?: string | null;
		id?: string;
		decorative?: boolean;
	}

	let { name, size = 16, icon, decorative = false }: Props = $props();

	let imageFailed = $state(false);
	let key = $derived(issueTypeIconKey(icon, name));
	let iconName = $derived(`issue-type-${key}` as IconName);
	let label = $derived(`${name} issue type`);
	let avatarUrl = $derived(
		icon?.startsWith("/api/avatars/issuetypes/") ? icon : null,
	);
	let useImage = $derived(Boolean(avatarUrl) && !imageFailed);
</script>

{#if useImage}
	<img
		src={avatarUrl}
		alt={decorative ? "" : label}
		onerror={() => (imageFailed = true)}
		style="width: {size}px; height: {size}px; object-fit: contain;"
	/>
{:else}
	<Icon name={iconName} {size} label={decorative ? undefined : label} />
{/if}
