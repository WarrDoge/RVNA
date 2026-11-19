<script lang="ts">
	import { untrack } from "svelte";
	import type { Attachment } from "svelte/attachments";
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import type { BoardConfig, StatusRef } from "#lib/api-types.ts";
	import { statusDrag } from "#lib/boards/dnd/attachments.ts";
	import DropZone from "#lib/boards/dnd/DropZone.svelte";
	import {
		keyboardDraggable,
		type KeyboardDirection,
	} from "#lib/boards/dnd/keyboard.ts";
	import Button from "#lib/components/Button.svelte";
	import SaveRow from "./SaveRow.svelte";

	interface Props {
		board: BoardConfig;
		canEdit: boolean;
	}

	type DraftColumn = {
		key: string;
		name: string;
		minIssues: number | null;
		maxIssues: number | null;
		statusIds: string[];
	};

	let { board, canEdit }: Props = $props();

	function fromBoard(value: BoardConfig): DraftColumn[] {
		return value.columns.map((column) => ({
			key: column.id,
			name: column.name,
			minIssues: column.minIssues,
			maxIssues: column.maxIssues,
			statusIds: column.statuses.map((status) => status.id),
		}));
	}

	let columns = $state<DraftColumn[]>(untrack(() => fromBoard(board)));
	let draggingStatus = $state<string | null>(null);
	let keyboardStatus = $state<string | null>(null);
	let keyboardColumnKey = $state<string | null>(null);
	let keyboardMessage = $state("");
	let saved = $state(false);
	let error = $state<string | null>(null);
	let pending = $state(false);

	function reset() {
		columns = fromBoard(board);
		keyboardStatus = null;
		keyboardColumnKey = null;
		keyboardMessage = "";
	}

	let assigned = $derived(
		new Set(columns.flatMap((column) => column.statusIds)),
	);
	let unassigned = $derived(
		board.availableStatuses.filter((status) => !assigned.has(status.id)),
	);
	let statusById = $derived(
		new Map<string, StatusRef>(
			board.availableStatuses.map((status) => [status.id, status]),
		),
	);

	function statusName(statusId: string) {
		return statusById.get(statusId)?.name ?? statusId;
	}

	function columnOf(statusId: string) {
		return columns.find((column) => column.statusIds.includes(statusId))?.key;
	}

	function moveStatus(statusId: string, columnKey: string) {
		const target = columns.find((column) => column.key === columnKey);
		if (!target || target.statusIds.includes(statusId)) return;
		columns = columns.map((column) => ({
			...column,
			statusIds:
				column.key === columnKey
					? [...column.statusIds, statusId]
					: column.statusIds.filter((id) => id !== statusId),
		}));
		saved = false;
	}

	function beginKeyboard(statusId: string) {
		keyboardStatus = statusId;
		keyboardColumnKey = columnOf(statusId) ?? columns[0]?.key ?? null;
		const column = columns.find((item) => item.key === keyboardColumnKey);
		keyboardMessage = `${statusName(statusId)} lifted. ${
			column ? `${column.name} selected.` : "No column selected."
		} Arrow keys choose a column, Space or Enter drops, Escape cancels.`;
	}

	function moveKeyboard(direction: KeyboardDirection) {
		if (!keyboardStatus || columns.length === 0) return;
		const index = columns.findIndex((column) => column.key === keyboardColumnKey);
		const next =
			direction === "left" || direction === "up"
				? Math.max(0, index - 1)
				: Math.min(columns.length - 1, index + 1);
		keyboardColumnKey = columns[next].key;
		keyboardMessage = `${statusName(keyboardStatus)} over ${columns[next].name}.`;
	}

	function dropKeyboard() {
		if (keyboardStatus && keyboardColumnKey) {
			moveStatus(keyboardStatus, keyboardColumnKey);
		}
		clearKeyboard();
	}

	function clearKeyboard() {
		keyboardStatus = null;
		keyboardColumnKey = null;
		keyboardMessage = "";
	}

	const dragAttachments = new Map<string, Attachment<HTMLElement>>();
	function dragFor(statusId: string) {
		let attachment = dragAttachments.get(statusId);
		if (!attachment) {
			attachment = statusDrag({
				getStatusId: () => statusId,
				isEnabled: () => canEdit,
				onDragStart: () => (draggingStatus = statusId),
				onDragEnd: () => (draggingStatus = null),
			});
			dragAttachments.set(statusId, attachment);
		}
		return attachment;
	}

	const keyboardAttachments = new Map<string, Attachment<HTMLElement>>();
	function keyboardFor(statusId: string) {
		let attachment = keyboardAttachments.get(statusId);
		if (!attachment) {
			attachment = keyboardDraggable({
				getKeys: () => [statusId],
				isEnabled: () => canEdit,
				isActive: () => keyboardStatus === statusId,
				onLift: () => beginKeyboard(statusId),
				onMove: (_keys, direction) => moveKeyboard(direction),
				onDrop: () => dropKeyboard(),
				onCancel: () => clearKeyboard(),
			});
			keyboardAttachments.set(statusId, attachment);
		}
		return attachment;
	}

	function updateColumn(
		key: string,
		change: (column: DraftColumn) => DraftColumn,
	) {
		columns = columns.map((column) =>
			column.key === key ? change(column) : column,
		);
		saved = false;
	}

	async function save() {
		if (pending) return;
		pending = true;
		saved = false;
		error = null;
		try {
			await api(`/api/boards/${board.rapidViewId}/columns`, {
				method: "PUT",
				body: JSON.stringify({
					columns: columns.map((column) => ({
						name: column.name.trim(),
						minIssues: column.minIssues,
						maxIssues: column.maxIssues,
						statuses: column.statusIds,
					})),
				}),
			});
			saved = true;
			await invalidate("app:board");
			reset();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			pending = false;
		}
	}
</script>

<section class="columns">
	<p class="intro">
		Drag statuses between columns, or focus a status and press Space, then the
		arrow keys, to move it with the keyboard. A status can only be in one
		column.
	</p>
	<p class="keyboard-help" aria-live="polite">{keyboardMessage}</p>
	{#if unassigned.length > 0}
		<div class="unassigned">
			<span class="label">Unmapped statuses</span>
			<div class="chips">
				{#each unassigned as status (status.id)}
					<button
						type="button"
						class="chip"
						class:keyboard-active={keyboardStatus === status.id}
						draggable={canEdit ? "true" : "false"}
						{@attach dragFor(status.id)}
						{@attach keyboardFor(status.id)}
					>
						{status.name}
					</button>
				{/each}
			</div>
		</div>
	{/if}
	<div class="column-list">
		{#each columns as column (column.key)}
			<DropZone
				kind="board-status"
				columnId={column.key}
				accept={["board-status"]}
				active={false}
				onDrop={(keys) => {
					if (keys[0]) moveStatus(keys[0], column.key);
					draggingStatus = null;
				}}
			>
				<fieldset
					aria-label={`Column ${column.name}`}
					class:keyboard-target={keyboardStatus !== null &&
						keyboardColumnKey === column.key}
				>
					<div class="column-head">
						<input
							class="input name"
							aria-label={`Column name ${column.name}`}
							bind:value={() => column.name, (value) =>
								updateColumn(column.key, (item) => ({
									...item,
									name: value,
								}))}
							disabled={!canEdit}
						/>
						<label class="number">
							<span class="label">Min</span>
							<input
								class="input count"
								aria-label={`Minimum issues ${column.name}`}
								type="number"
								min="0"
								bind:value={() => column.minIssues ?? "", (value) =>
									updateColumn(column.key, (item) => ({
										...item,
										minIssues:
											value === "" ? null : Number(value),
									}))}
								disabled={!canEdit}
							/>
						</label>
						<label class="number">
							<span class="label">Max</span>
							<input
								class="input count"
								aria-label={`Maximum issues ${column.name}`}
								type="number"
								min="0"
								bind:value={() => column.maxIssues ?? "", (value) =>
									updateColumn(column.key, (item) => ({
										...item,
										maxIssues:
											value === "" ? null : Number(value),
									}))}
								disabled={!canEdit}
							/>
						</label>
						<Button
							spacing="compact"
							appearance="danger"
							onclick={() => {
								columns = columns.filter((item) => item.key !== column.key);
								saved = false;
							}}
							isDisabled={!canEdit}
						>
							Remove
						</Button>
					</div>
					<div class="chips column-statuses">
						{#each column.statusIds as statusId (statusId)}
							{@const status = statusById.get(statusId)}
							<span class="chip">
								<button
									type="button"
									class="drag-handle"
									class:keyboard-active={keyboardStatus === statusId}
									draggable={canEdit ? "true" : "false"}
									{@attach dragFor(statusId)}
									{@attach keyboardFor(statusId)}
								>
									{status?.name ?? statusId}
								</button>
								<button
									type="button"
									class="remove-status"
									aria-label={`Remove ${status?.name ?? statusId}`}
									onclick={() =>
										updateColumn(column.key, (item) => ({
											...item,
											statusIds: item.statusIds.filter((id) => id !== statusId),
										}))}
								>
									×
								</button>
							</span>
						{/each}
						{#if column.statusIds.length === 0}
							<span class="drop-hint">Drop statuses here</span>
						{/if}
					</div>
				</fieldset>
			</DropZone>
		{/each}
	</div>
	<div class="footer">
		<Button
			onclick={() => {
				columns = [
					...columns,
					{
						key: crypto.randomUUID(),
						name: "New column",
						minIssues: null,
						maxIssues: null,
						statusIds: [],
					},
				];
				saved = false;
			}}
			isDisabled={!canEdit}
		>
			Add column
		</Button>
		<SaveRow {saved} {error} pending={pending} disabled={!canEdit} onSave={save} />
	</div>
</section>

<style>
	.columns {
		width: 100%;
	}

	.intro {
		margin: 0;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.keyboard-help:empty {
		display: none;
	}

	.keyboard-help {
		margin: 8px 0 0;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
	}

	.unassigned {
		margin-bottom: 12px;
	}

	.label {
		display: block;
		margin-bottom: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		background-color: var(--ds-background-neutral, #0515240f);
		color: var(--ds-text, #cecfd2);
		font-size: 12px;
		cursor: grab;
	}

	button.chip {
		font: inherit;
		font-size: 12px;
	}

	.keyboard-active {
		outline: 2px solid var(--ds-border-selected, #669df1);
		outline-offset: 1px;
	}

	.column-list {
		display: grid;
		gap: 10px;
	}

	fieldset {
		margin: 0;
		padding: 10px;
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		background-color: var(--ds-surface-raised, #242528);
	}

	fieldset.keyboard-target {
		border-color: var(--ds-border-selected, #669df1);
		outline: 1px dashed var(--ds-border-selected, #669df1);
		outline-offset: 2px;
	}

	.column-head {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.input {
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input, #242528);
		border: 1px solid var(--ds-border-input, #7e8188);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		font-size: 14px;
	}

	.name {
		width: 100%;
		max-width: 220px;
	}

	.count {
		width: 70px;
	}

	.number {
		display: flex;
		gap: 4px;
		align-items: center;
	}

	.column-statuses {
		margin-top: 8px;
		min-height: 28px;
	}

	.drag-handle,
	.remove-status {
		padding: 0;
		background: transparent;
		border: 0;
		color: inherit;
		cursor: grab;
	}

	.remove-status {
		margin-left: 4px;
		cursor: pointer;
	}

	.drop-hint {
		color: var(--ds-text-subtlest, #96999e);
		font-size: 12px;
	}

	.footer {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}
</style>
