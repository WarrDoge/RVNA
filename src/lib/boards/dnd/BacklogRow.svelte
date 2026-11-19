<script lang="ts">
	import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
	import { mount, unmount } from "svelte";
	import type { BoardIssue, EstimationField } from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import {
		backlogRowDrag,
		backlogRowDropTarget,
	} from "./attachments.ts";
	import { estimateLabel } from "./board-dnd.ts";
	import DragPreview from "./DragPreview.svelte";
	import EpicLozenge from "./EpicLozenge.svelte";
	import {
		keyboardDraggable,
		type KeyboardDirection,
	} from "./keyboard.ts";

	interface Props {
		issue: BoardIssue;
		estimationField: EstimationField;
		selected: boolean;
		dragKeys: string[];
		onClick: (event: {
			ctrlKey: boolean;
			shiftKey: boolean;
			metaKey: boolean;
		}) => void;
		onOpen: () => void;
		onDragStart: () => void;
		onDragEnd: () => void;
		onDropBefore: (keys: string[]) => void;
		dragPreview?: boolean;
		keyboardActive?: boolean;
		onKeyboardLift?: () => void;
		onKeyboardMove?: (direction: KeyboardDirection) => void;
		onKeyboardDrop?: () => void;
		onKeyboardCancel?: () => void;
	}

	let {
		issue,
		estimationField,
		selected,
		dragKeys,
		onClick,
		onOpen,
		onDragStart,
		onDragEnd,
		onDropBefore,
		dragPreview = false,
		keyboardActive = false,
		onKeyboardLift,
		onKeyboardMove,
		onKeyboardDrop,
		onKeyboardCancel,
	}: Props = $props();

	let over = $state(false);
	let dragged = $state(false);

	let estimate = $derived(estimateLabel(issue.estimate, estimationField));
	let done = $derived(issue.status.category === "done");

	const drag = backlogRowDrag({
		getIssue: () => issue,
		getDragKeys: () => dragKeys,
		onDragStart: () => {
			dragged = true;
			onDragStart();
		},
		onDragEnd: () => {
			setTimeout(() => {
				dragged = false;
			}, 0);
			onDragEnd();
		},
		onGenerateDragPreview: ({ nativeSetDragImage, issue: previewIssue }) => {
			if (!dragPreview || !nativeSetDragImage) return;
			setCustomNativeDragPreview({
				nativeSetDragImage,
				render: ({ container }) => {
					const preview = mount(DragPreview, {
						target: container,
						props: {
							issue: previewIssue,
							estimationField,
						},
					});
					return () => {
						void unmount(preview);
					};
				},
			});
		},
	});

	const target = backlogRowDropTarget({
		getIssue: () => issue,
		onOverChange: (value) => {
			over = value;
		},
		onDropBefore: (keys) => onDropBefore(keys),
	});

	const keyboard = keyboardDraggable({
		getKeys: () => [issue.key],
		isEnabled: () => Boolean(onKeyboardLift),
		isActive: () => keyboardActive,
		onLift: () => onKeyboardLift?.(),
		onMove: (_keys, direction) => onKeyboardMove?.(direction),
		onDrop: () => onKeyboardDrop?.(),
		onCancel: () => onKeyboardCancel?.(),
	});

	function click(event: MouseEvent) {
		if (dragged) return;
		onClick({
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			metaKey: event.metaKey,
		});
	}
</script>

<button
	type="button"
	class="backlog-row"
	class:selected
	class:over
	class:done
	class:keyboard-active={keyboardActive}
	data-testid={`backlog-row-${issue.key}`}
	aria-label={`${issue.key} ${issue.summary}`}
	onclick={click}
	ondblclick={() => onOpen()}
	{@attach drag}
	{@attach target}
	{@attach keyboard}
>
	<span class="row-checkbox" aria-hidden="true">{selected ? "✓" : ""}</span>
	<IssueTypeIcon
		id={issue.type.id}
		name={issue.type.name}
		icon={issue.type.iconUrl}
	/>
	{#if issue.priority}<PriorityIcon name={issue.priority.name} />{/if}
	<span class="row-key">{issue.key}</span>
	<span class="row-summary">{issue.summary}</span>
	{#if issue.epic}<EpicLozenge epic={issue.epic} maxWidth={150} />{/if}
	{#if estimate !== ""}
		<span class="row-estimate">{estimate}</span>
	{/if}
	{#if issue.assignee}
		<Avatar user={issue.assignee} size={24} />
	{:else}
		<span class="row-avatar-space"></span>
	{/if}
</button>

<style>
	.backlog-row {
		width: 100%;
		text-align: left;
		font: inherit;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 34px;
		padding: 4px 8px;
		border: 0;
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		background-color: transparent;
		cursor: grab;
	}

	.backlog-row.selected {
		background-color: var(--ds-background-selected, #1c2b41);
	}

	.backlog-row.over {
		background-color: var(--ds-background-neutral-hovered, #2c2e33);
	}

	.backlog-row.selected.over {
		background-color: var(--ds-background-selected, #1c2b41);
	}

	.backlog-row.keyboard-active {
		outline: 2px solid var(--ds-border-selected, #669df1);
		outline-offset: -2px;
	}

	.row-checkbox {
		width: 14px;
		height: 14px;
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--ds-border-input, #7a7d82);
		border-radius: 2px;
		background-color: transparent;
		color: var(--ds-text-inverse, #1d2125);
		font-size: 11px;
		font-weight: 700;
	}

	.backlog-row.selected .row-checkbox {
		background-color: var(--ds-background-selected-bold, #669df1);
	}

	.row-key {
		width: 78px;
		flex: none;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.backlog-row.done .row-key {
		color: var(--ds-text-subtlest, #7a7d82);
		text-decoration: line-through;
	}

	.row-summary {
		flex: 1;
		min-width: 0;
		font-size: 14px;
		color: var(--ds-text, #cecfd2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.backlog-row.done .row-summary {
		color: var(--ds-text-subtlest, #7a7d82);
		text-decoration: line-through;
	}

	.row-estimate {
		min-width: 24px;
		text-align: right;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.row-avatar-space {
		width: 24px;
	}
</style>
