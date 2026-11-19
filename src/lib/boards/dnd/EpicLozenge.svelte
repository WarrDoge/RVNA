<script lang="ts">
	import type { BoardIssue } from "#lib/api-types.ts";
	import { epicColour, readableText } from "./board-dnd.ts";

	interface Props {
		epic: NonNullable<BoardIssue["epic"]>;
		maxWidth?: number;
	}

	let { epic, maxWidth = 180 }: Props = $props();

	let background = $derived(epicColour(epic.colour));
	let colour = $derived(readableText(background));
</script>

<span
	class="epic-lozenge"
	title={`${epic.key} ${epic.summary}`}
	style="max-width: min({maxWidth}px, 100%); background-color: {background}; color: {colour};"
>
	{epic.summary}
</span>

<style>
	.epic-lozenge {
		display: inline-block;
		padding: 0 4px;
		border-radius: 3px;
		font-size: 11px;
		font-weight: 600;
		line-height: 16px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
