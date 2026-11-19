<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { PriorityRef } from "#lib/api-types.ts";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import { inlineIconStyle } from "./styles.ts";

	interface Props {
		priority: PriorityRef | null;
	}

	let { priority }: Props = $props();

	const noneStyle = `color: ${token("color.text.subtle")};`;
</script>

{#if priority}
	<span style={inlineIconStyle}>
		<PriorityIcon id={priority.id} iconUrl={priority.iconUrl} name={priority.name} />
		{priority.name}
	</span>
{:else}
	<span style={noneStyle}>None</span>
{/if}
