<script lang="ts">
	import Icon from "./Icon.svelte";
	import { priorityIconName } from "./icons.ts";

	interface Props {
		name: string;
		size?: number;
		id?: string;
		iconUrl?: string | null;
	}

	let { name, size = 16, iconUrl }: Props = $props();

	let imageFailed = $state(false);
	let label = $derived(`${name} priority`);
	let iconName = $derived(priorityIconName(name));
	let useImage = $derived(Boolean(iconUrl) && !imageFailed);
</script>

{#if useImage}
	<img
		src={iconUrl}
		alt={label}
		onerror={() => (imageFailed = true)}
		style="width: {size}px; height: {size}px; object-fit: contain;"
	/>
{:else}
	<Icon name={iconName} {size} label={label} />
{/if}
