<script lang="ts">
	import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
	import { mount, unmount } from "svelte";
	import type {
		BoardIssue,
		CardColourStrategy,
		EstimationField,
	} from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import {
		boardCardDrag,
		boardCardDropTarget,
	} from "./attachments.ts";
	import { cardBackground, estimateLabel } from "./board-dnd.ts";
	import DragPreview from "./DragPreview.svelte";
	import EpicLozenge from "./EpicLozenge.svelte";
	import FlagIcon from "./FlagIcon.svelte";
	import {
		keyboardDraggable,
		type KeyboardDirection,
	} from "./keyboard.ts";

	interface Props {
		issue: BoardIssue;
		estimationField: EstimationField;
		cardColourStrategy: CardColourStrategy;
		selected: boolean;
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
		cardColourStrategy,
		selected,
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

	let background = $derived(cardBackground(issue, cardColourStrategy));
	let estimate = $derived(estimateLabel(issue.estimate, estimationField));
	let done = $derived(issue.status.category === "done");

	const drag = boardCardDrag({
		getIssue: () => issue,
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
							cardColourStrategy,
						},
					});
					return () => {
						void unmount(preview);
					};
				},
			});
		},
	});

	const target = boardCardDropTarget({
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

	function open() {
		if (!dragged) onOpen();
	}
</script>

<button
	type="button"
	class="board-card"
	class:selected
	class:over
	class:done
	class:keyboard-active={keyboardActive}
	aria-label={`${issue.key} ${issue.summary}`}
	data-testid={`board-card-${issue.key}`}
	onclick={open}
	style="--board-card-bg: {background};"
	{@attach drag}
	{@attach target}
	{@attach keyboard}
>
	<div class="card-top">
		{#if issue.flagged}<FlagIcon />{/if}
		<span class="card-key">{issue.key}</span>
		<span class="card-avatar">
			{#if issue.assignee}
				<Avatar user={issue.assignee} size={24} />
			{:else}
				<span class="avatar-placeholder" aria-hidden="true"></span>
			{/if}
		</span>
	</div>
	<div class="card-summary">{issue.summary}</div>
	{#if issue.epic}
		<div class="card-epic">
			<EpicLozenge epic={issue.epic} />
		</div>
	{/if}
	<div class="card-footer">
		<IssueTypeIcon
			id={issue.type.id}
			name={issue.type.name}
			icon={issue.type.iconUrl}
		/>
		{#if issue.priority}<PriorityIcon name={issue.priority.name} />{/if}
		{#if estimate !== ""}
			<span class="card-estimate">{estimate}</span>
		{/if}
	</div>
</button>

<style>
	.board-card {
		display: block;
		width: 100%;
		text-align: left;
		font: inherit;
		position: relative;
		padding: 8px 10px;
		margin-bottom: 8px;
		background-color: var(--board-card-bg);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 2px;
		box-shadow: var(--ds-shadow-raised, 0 1px 1px #0000004d);
		cursor: grab;
		color: var(--ds-text, #cecfd2);
	}

	.board-card.over {
		border-color: var(--ds-border-focused, #669df1);
	}

	.board-card.selected {
		border-color: var(--ds-border-selected, #669df1);
	}

	.board-card.keyboard-active {
		outline: 2px solid var(--ds-border-selected, #669df1);
		outline-offset: 1px;
	}

	.card-top {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 24px;
	}

	.card-key {
		font-size: 12px;
		font-weight: 600;
		line-height: 16px;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.board-card.done .card-key {
		color: var(--ds-text-subtlest, #7a7d82);
		text-decoration: line-through;
	}

	.card-avatar {
		margin-left: auto;
	}

	.avatar-placeholder {
		display: inline-block;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background-color: var(--ds-background-neutral, #2c2e33);
	}

	.card-summary {
		margin-top: 4px;
		font-size: 14px;
		line-height: 20px;
		color: var(--ds-text, #cecfd2);
		display: -webkit-box;
		line-clamp: 3;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.board-card.done .card-summary {
		color: var(--ds-text-subtlest, #7a7d82);
		text-decoration: line-through;
	}

	.card-epic {
		margin-top: 6px;
	}

	.card-footer {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
		min-height: 16px;
	}

	.card-estimate {
		margin-left: auto;
		padding: 0 5px;
		border-radius: 3px;
		background-color: var(--ds-background-neutral, #2c2e33);
		font-size: 11px;
		font-weight: 600;
		line-height: 16px;
	}
</style>
