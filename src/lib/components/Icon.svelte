<script lang="ts">
	import { iconDefinitions, type IconName } from "./icons.ts";

	interface Props {
		name: IconName;
		size?: number;
		label?: string;
	}

	let { name, size, label }: Props = $props();

	let definition = $derived(iconDefinitions[name]);
	let resolvedSize = $derived(size ?? definition.size);
</script>

<svg
	width={resolvedSize}
	height={resolvedSize}
	viewBox={definition.viewBox}
	fill={definition.fill}
	role={label ? "img" : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
>
	{#if label}<title>{label}</title>{/if}
	{@html definition.body}
</svg>
