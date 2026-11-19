<script lang="ts">
	import type {
		BoardColumn,
		BoardIssue,
		CardColourStrategy,
		EstimationField,
	} from "#lib/api-types.ts";
	import BoardCard from "#lib/boards/dnd/BoardCard.svelte";
	import DropZone from "#lib/boards/dnd/DropZone.svelte";
	import Icon from "#lib/components/Icon.svelte";

	interface Props {
		name: string | null;
		issues: BoardIssue[];
		columns: BoardColumn[];
		estimationField: EstimationField;
		cardColourStrategy: CardColourStrategy;
		selectedKey: string | null;
		dragging: boolean;
		onOpen: (key: string | null) => void;
		onDragStart: () => void;
		onDragEnd: () => void;
		onMove: (
			keys: string[],
			target: { columnId?: string; statusId?: string; before?: string },
		) => void;
	}

	let {
		name,
		issues,
		columns,
		estimationField,
		cardColourStrategy,
		selectedKey,
		dragging,
		onOpen,
		onDragStart,
		onDragEnd,
		onMove,
	}: Props = $props();

	let open = $state(true);
</script>

<section class="swimlane">
	{#if name}
		<button
			type="button"
			class="lane-toggle"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<span class="chevron" class:collapsed={!open}>
				<Icon name="chevron-down" />
			</span>
			{name}
			<span class="lane-count">({issues.length})</span>
		</button>
	{/if}
	{#if open}
		<div
			class="lane-columns"
			style:grid-template-columns="repeat({columns.length}, minmax(160px, 1fr))"
		>
			{#each columns as column (column.id)}
				{@const columnIssues = issues.filter(
					(issue) => issue.columnId === column.id,
				)}
				<DropZone
					kind="board-column"
					columnId={column.id}
					testId={`board-column-${column.id}`}
					active={dragging}
					onDrop={(keys) => onMove(keys, { columnId: column.id })}
					class="lane-column-zone"
				>
					{#each columnIssues as issue (issue.key)}
						<BoardCard
							{issue}
							{estimationField}
							{cardColourStrategy}
							selected={selectedKey === issue.key}
							onOpen={() => onOpen(issue.key)}
							{onDragStart}
							{onDragEnd}
							onDropBefore={(keys) =>
								onMove(keys, { columnId: column.id, before: issue.key })}
						/>
					{/each}
					{#if dragging && column.statuses.length > 1}
						<div class="status-zones">
							{#each column.statuses as status (status.id)}
								<DropZone
									kind="board-status"
									columnId={column.id}
									statusId={status.id}
									active={dragging}
									label={status.name}
									onDrop={(keys) =>
										onMove(keys, {
											columnId: column.id,
											statusId: status.id,
										})}
									class="lane-status-zone"
								/>
							{/each}
						</div>
					{/if}
					{#if columnIssues.length === 0 && !dragging}
						<div class="empty">No issues</div>
					{/if}
				</DropZone>
			{/each}
		</div>
	{/if}
</section>

<style>
	.swimlane {
		margin-top: 8px;
	}

	.lane-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 4px 8px;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
	}

	.chevron {
		display: inline-flex;
	}

	.chevron.collapsed {
		transform: rotate(-90deg);
	}

	.lane-count {
		font-weight: 400;
	}

	.lane-columns {
		display: grid;
		gap: 8px;
		margin-top: 4px;
	}

	.status-zones {
		margin-top: 4px;
	}

	.empty {
		padding: 8px;
		font-size: 12px;
		color: var(--ds-text-subtlest, #96999e);
	}

	:global(.lane-column-zone) {
		min-width: 0;
		min-height: 90px;
		padding: 6px;
		display: flex;
		flex-direction: column;
		background-color: var(--ds-surface-sunken, #161719);
		border-radius: 3px;
	}

	:global(.lane-status-zone) {
		margin-bottom: 4px;
		padding: 4px;
		border-radius: 3px;
	}
</style>
