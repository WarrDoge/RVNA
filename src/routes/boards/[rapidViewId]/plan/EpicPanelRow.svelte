<script lang="ts">
	import type { BacklogPageData } from "./types.ts";
	import { dropZone } from "#lib/boards/dnd/attachments.ts";
	import { BACKLOG_ACCEPT } from "#lib/boards/dnd/board-dnd.ts";
	import EpicLozenge from "#lib/boards/dnd/EpicLozenge.svelte";

	interface Props {
		epic: BacklogPageData["epics"][number];
		active: boolean;
		onClick: () => void;
		onDrop: (epicKey: string, keys: string[]) => void;
	}

	let { epic, active, onClick, onDrop }: Props = $props();

	let over = $state(false);

	const target = dropZone({
		getKind: () => "board-column",
		getColumnId: () => undefined,
		getStatusId: () => undefined,
		getAccept: () => BACKLOG_ACCEPT,
		onOverChange: (value) => {
			over = value;
		},
		onDrop: (keys) => onDrop(epic.key, keys),
	});
</script>

<button
	type="button"
	class="epic-row"
	class:active
	class:over
	aria-pressed={active}
	onclick={onClick}
	{@attach target}
>
	<span class="epic-name">
		<EpicLozenge
			epic={{ key: epic.key, summary: epic.summary, colour: epic.colour }}
			maxWidth={160}
		/>
	</span>
	<span class="epic-count">{epic.issueCount}</span>
</button>

<style>
	.epic-row {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 4px 6px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}

	.epic-row.active,
	.epic-row.over {
		background-color: var(--ds-background-selected);
	}

	.epic-name {
		flex: 1;
		min-width: 0;
	}

	.epic-count {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
