<script lang="ts">
	import type {
		BoardConfig,
		BoardIssue,
		BoardQuickFilter,
	} from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";

	interface Props {
		board: BoardConfig;
		quickFilters: BoardQuickFilter[];
		selectedQuickFilters: string[];
		onToggleQuickFilter: (id: string) => void;
		assignees: NonNullable<BoardIssue["assignee"]>[];
		assignee: string | null;
		onAssignee: (username: string) => void;
		onClearAssignee: () => void;
		text: string;
		onText: (value: string) => void;
	}

	let {
		board,
		quickFilters,
		selectedQuickFilters,
		onToggleQuickFilter,
		assignees,
		assignee,
		onAssignee,
		onClearAssignee,
		text,
		onText,
	}: Props = $props();

	let visibleAssignees = $derived.by(() => {
		const visible = assignees.slice(0, 12);
		if (assignee && !visible.some((user) => user.username === assignee)) {
			const active = assignees.find((user) => user.username === assignee);
			if (active) visible.push(active);
		}
		return visible;
	});
</script>

<div class="board-toolbar">
	<span class="label">QUICK FILTERS:</span>
	{#each quickFilters as filter (filter.id)}
		{@const active = selectedQuickFilters.includes(filter.id)}
		<button
			type="button"
			class="quick-filter"
			class:active
			aria-pressed={active}
			onclick={() => onToggleQuickFilter(filter.id)}
		>
			{filter.name}
		</button>
	{/each}
	{#if assignees.length > 0}
		<span class="assignees" title="Filter by assignee">
			{#each visibleAssignees as user (user.username)}
				<button
					type="button"
					class="assignee"
					class:active={assignee === user.username}
					title={user.displayName}
					aria-label={`Filter by ${user.displayName}`}
					aria-pressed={assignee === user.username}
					onclick={() => onAssignee(user.username)}
				>
					<Avatar {user} size={22} />
				</button>
			{/each}
			{#if assignee}
				<button
					type="button"
					class="clear-assignee"
					onclick={onClearAssignee}
				>
					Clear
				</button>
			{/if}
		</span>
	{/if}
	<input
		type="search"
		class="search"
		aria-label="Search board"
		placeholder="Search board"
		bind:value={() => text, (value) => onText(value)}
	/>
	{#if board.type === "kanban" && board.kanbanBacklogStatus}
		<span class="backlog-status">Backlog: {board.kanbanBacklogStatus.name}</span>
	{/if}
</div>

<style>
	.board-toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		padding: 6px 16px 8px;
		border-bottom: 1px solid var(--ds-border, #3b3d42);
	}

	.label {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.4px;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.quick-filter {
		padding: 0 6px;
		height: 24px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 13px;
		cursor: pointer;
		text-decoration: none;
	}

	.quick-filter.active {
		color: var(--ds-link, #669df1);
		text-decoration: underline;
	}

	.assignees {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: 8px;
	}

	.assignee {
		padding: 0;
		border: 2px solid transparent;
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
		line-height: 0;
	}

	.assignee.active {
		border-color: var(--ds-border-selected, #669df1);
	}

	.clear-assignee {
		height: 24px;
		padding: 0 6px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-link, #669df1);
		font-size: 12px;
		cursor: pointer;
	}

	.search {
		margin-left: auto;
		width: 200px;
		height: 28px;
		padding: 0 8px;
		background-color: var(--ds-background-input, #242528);
		border: 1px solid var(--ds-border-input, #7e8188);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		font-size: 13px;
	}

	.backlog-status {
		font-size: 12px;
		color: var(--ds-text-subtle, #a9abaf);
	}
</style>
