<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { Snippet } from "svelte";
	import { dropZone, type DropKind } from "./attachments.ts";
	import { BOARD_ONLY, cssStyle, type DndStyle } from "./board-dnd.ts";

	interface Props {
		onDrop: (keys: string[]) => void;
		children?: Snippet;
		style?: string | DndStyle;
		active: boolean;
		label?: string;
		columnId?: string;
		statusId?: string;
		kind?: DropKind;
		accept?: string[];
		testId?: string;
		class?: string;
	}

	let {
		onDrop,
		children,
		style,
		active,
		label,
		columnId,
		statusId,
		kind = "board-column",
		accept = BOARD_ONLY,
		testId,
		class: className = "",
	}: Props = $props();

	let over = $state(false);

	const target = dropZone({
		getKind: () => kind,
		getColumnId: () => columnId,
		getStatusId: () => statusId,
		getAccept: () => accept,
		onOverChange: (value) => {
			over = value;
		},
		onDrop: (keys) => onDrop(keys),
	});

	let resolvedStyle = $derived.by(() => {
		let value = cssStyle(style);
		if (over) {
			value += ` background-color: ${token("color.background.selected", "#1c2b41")};`;
		}
		if (active && kind === "board-status" && !over) {
			value += ` outline: 1px dashed ${token("color.border", "#3b3d42")};`;
		}
		return value;
	});
</script>

<div
	class="drop-zone {over ? 'over' : ''} {className}"
	class:active
	data-testid={testId}
	style={resolvedStyle}
	{@attach target}
>
	{#if label}
		<div class="drop-zone-label">{label}</div>
	{/if}
	{@render children?.()}
</div>

<style>
	.drop-zone {
		position: relative;
	}

	.drop-zone-label {
		padding: 4px 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--ds-text-subtle, #a9abaf);
		text-transform: uppercase;
	}
</style>
