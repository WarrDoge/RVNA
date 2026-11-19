<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { page } from "$app/state";
	import { onDestroy } from "svelte";
	import type { BoardIssue } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import BoardShell from "#lib/boards/BoardShell.svelte";
	import MissingBoard from "#lib/boards/MissingBoard.svelte";
	import Button from "#lib/components/Button.svelte";
	import IssueDetailView from "#lib/issue/IssueDetailView.svelte";
	import IssueUnavailable from "#lib/issue/IssueUnavailable.svelte";
	import BoardToolbar from "./BoardToolbar.svelte";
	import ColumnHeader from "./ColumnHeader.svelte";
	import CompleteSprintDialog from "./CompleteSprintDialog.svelte";
	import Swimlane from "./Swimlane.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let dragging = $state(false);
	let completeOpen = $state(false);
	let actionError = $state<string | null>(null);

	let text = $state(page.url.searchParams.get("text") ?? "");
	let lastUrlText = $state(page.url.searchParams.get("text") ?? "");
	let textTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(textTimer));

	let selectedQuickFilters = $derived(
		(page.url.searchParams.get("quickFilter") ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	);
	let assignee = $derived(
		page.url.searchParams.get("assignee")?.trim() || null,
	);
	let selectedKey = $derived(
		page.url.searchParams.get("selectedIssue")?.trim().toUpperCase() || null,
	);

	let boardData = $derived(data.data);
	let columns = $derived(boardData?.columns ?? []);
	let boardMinWidth = $derived(
		columns.length * 160 + Math.max(0, columns.length - 1) * 8,
	);
	let flatIssues = $derived.by(() => {
		const value = boardData;
		if (!value) return [] as BoardIssue[];
		return value.columns.flatMap((column) =>
			value.swimlanes.flatMap((lane) =>
				lane.issues.filter((issue) => issue.columnId === column.id),
			),
		);
	});
	let assignees = $derived.by(() => {
		const seen = new Map<string, NonNullable<BoardIssue["assignee"]>>();
		for (const issue of flatIssues) {
			if (issue.assignee) seen.set(issue.assignee.username, issue.assignee);
		}
		if (assignee && !seen.has(assignee)) {
			seen.set(assignee, {
				id: "",
				username: assignee,
				displayName: assignee,
				avatarUrl: null,
			});
		}
		return [...seen.values()];
	});

	$effect(() => {
		const next = page.url.searchParams.get("text") ?? "";
		if (next === lastUrlText) return;
		lastUrlText = next;
		clearTimeout(textTimer);
		text = next;
	});

	function remainingDays(endDate: string | null) {
		if (!endDate) return "";
		const end = new Date(endDate);
		const days = Math.ceil(
			(end.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
		);
		if (days <= 0) return "0 days remaining";
		return days === 1 ? "1 day remaining" : `${days} days remaining`;
	}

	function updateParams(patch: Record<string, string | null>) {
		const url = new URL(page.url.href);
		for (const [key, value] of Object.entries(patch)) {
			if (value === null || value === "") url.searchParams.delete(key);
			else url.searchParams.set(key, value);
		}
		void goto(`${url.pathname}${url.search}${url.hash}`, {
			replace: true,
			reset: false,
		});
	}

	function setSelected(key: string | null) {
		updateParams({ selectedIssue: key });
	}

	function onText(value: string) {
		text = value;
		clearTimeout(textTimer);
		textTimer = setTimeout(() => {
			const trimmed = value.trim();
			if (trimmed === (page.url.searchParams.get("text") ?? "")) return;
			updateParams({ text: trimmed || null });
		}, 250);
	}

	function toggleQuickFilter(id: string) {
		const next = selectedQuickFilters.includes(id)
			? selectedQuickFilters.filter((item) => item !== id)
			: [...selectedQuickFilters, id];
		updateParams({ quickFilter: next.length > 0 ? next.join(",") : null });
	}

	function toggleAssignee(username: string) {
		updateParams({ assignee: assignee === username ? null : username });
	}

	function columnCount(columnId: string) {
		if (!boardData) return 0;
		return boardData.swimlanes.reduce(
			(sum, lane) =>
				sum + lane.issues.filter((issue) => issue.columnId === columnId).length,
			0,
		);
	}

	async function moveIssues(
		keys: string[],
		target: { columnId?: string; statusId?: string; before?: string },
	) {
		const value = boardData;
		if (!value) return;
		try {
			await api(`/api/boards/${value.board.rapidViewId}/move`, {
				method: "POST",
				keepalive: true,
				body: JSON.stringify({
					issues: keys,
					columnId: target.columnId,
					statusId: target.statusId,
					before: target.before,
					sprintId:
						value.board.type === "scrum" ? value.activeSprint?.id : undefined,
				}),
			});
			actionError = null;
			await invalidate("app:board");
		} catch (cause) {
			actionError =
				cause instanceof Error ? cause.message : "Something went wrong";
		}
	}

	function onKeyDown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (
			target?.closest(
				"input, textarea, select, [contenteditable='true'], [role='dialog']",
			)
		) {
			return;
		}
		if (event.key === "t") {
			event.preventDefault();
			if (selectedKey) setSelected(null);
			else if (flatIssues[0]) setSelected(flatIssues[0].key);
			return;
		}
		if (event.key === "Escape" && selectedKey) {
			setSelected(null);
			return;
		}
		if (event.key !== "j" && event.key !== "k") return;
		event.preventDefault();
		if (flatIssues.length === 0) return;
		const index = flatIssues.findIndex((issue) => issue.key === selectedKey);
		const next =
			event.key === "j"
				? Math.min(flatIssues.length - 1, index + 1)
				: Math.max(0, index - 1);
		setSelected(flatIssues[index < 0 ? 0 : next].key);
	}
</script>

<svelte:window onkeydown={onKeyDown} />

{#if data.missing}
	<MissingBoard />
{:else}
	<BoardShell board={data.data.board} sidebar={data.sidebar} active="board">
		<div class="work-main">
			<div class="board-header">
				<div class="title-block">
					<div class="board-name">{data.data.board.name}</div>
					<h1>
						{data.data.board.type === "kanban"
							? "Kanban board"
							: (data.data.activeSprint?.name ?? "No active sprint")}
					</h1>
				</div>
				<div class="header-actions">
					{#if data.data.activeSprint}
						<span class="remaining">
							{remainingDays(data.data.activeSprint.endDate)}
						</span>
					{/if}
					{#if data.data.activeSprint}
						<Button spacing="compact" onclick={() => (completeOpen = true)}>
							Complete sprint
						</Button>
					{/if}
				</div>
			</div>

			<BoardToolbar
				board={data.data.board}
				quickFilters={data.data.quickFilters}
				{selectedQuickFilters}
				onToggleQuickFilter={toggleQuickFilter}
				{assignees}
				{assignee}
				onAssignee={toggleAssignee}
				onClearAssignee={() => updateParams({ assignee: null })}
				{text}
				{onText}
			/>

			{#if actionError}
				<div class="action-error" role="alert">{actionError}</div>
			{/if}

			{#if data.data.board.type === "scrum" && !data.data.activeSprint}
				<div class="no-sprint">
					<h2>No active sprint</h2>
					<p>
						Start a sprint from the
						<a
							href={`/secure/RapidBoard.jspa?rapidView=${data.data.board.rapidViewId}&view=planning`}
						>
							backlog
						</a>.
					</p>
				</div>
			{:else}
				<div class="board-scroll">
					<div class="board-inner" style:min-width={`${boardMinWidth}px`}>
						<div
							class="column-headers"
							style:grid-template-columns={`repeat(${columns.length}, minmax(160px, 1fr))`}
						>
							{#each columns as column (column.id)}
								<ColumnHeader
									name={column.name}
									count={columnCount(column.id)}
									min={column.minIssues}
									max={column.maxIssues}
								/>
							{/each}
						</div>
						{#each data.data.swimlanes as lane (lane.id)}
							<Swimlane
								name={lane.name}
								issues={lane.issues}
								{columns}
								estimationField={data.data.board.estimationField}
								cardColourStrategy={data.data.board.cardColourStrategy}
								{selectedKey}
								{dragging}
								onOpen={setSelected}
								onDragStart={() => (dragging = true)}
								onDragEnd={() => (dragging = false)}
								onMove={moveIssues}
							/>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if selectedKey}
			<aside class="issue-panel">
				{#if data.selectedIssue}
					{#key data.selectedIssue.issue.key}
						<IssueDetailView
							view={data.selectedIssue}
							narrow
							onClose={() => setSelected(null)}
						/>
					{/key}
				{:else}
					<IssueUnavailable />
				{/if}
			</aside>
		{/if}

		{#if completeOpen && data.data.activeSprint && data.sprintSummary}
			{#key data.data.board.rapidViewId}
				<CompleteSprintDialog
					sprint={data.data.activeSprint}
					completed={data.sprintSummary.completed}
					incomplete={data.sprintSummary.incomplete}
					futureSprints={data.sprintSummary.futureSprints}
					onClose={() => (completeOpen = false)}
					onCompleted={() => {
						completeOpen = false;
						void invalidate("app:board");
					}}
				/>
			{/key}
		{/if}
	</BoardShell>
{/if}

<style>
	.work-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		height: calc(100vh - 56px);
	}

	.board-header {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		padding: 10px 16px 6px;
	}

	.title-block {
		min-width: 0;
	}

	.board-name {
		font-size: 12px;
		line-height: 16px;
		color: var(--ds-text-subtle, #a9abaf);
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.header-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
		padding-right: var(--board-header-actions-right, 0);
	}

	.remaining {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 13px;
	}

	.action-error {
		margin: 0 16px 8px;
		padding: 6px 10px;
		border: 1px solid var(--ds-border-danger, #e5493a);
		border-radius: 3px;
		color: var(--ds-text-danger, #e5493a);
		font-size: 13px;
	}

	.no-sprint {
		padding: 40px 24px;
	}

	.no-sprint h2 {
		margin: 0 0 8px;
		font-size: 18px;
		font-weight: 500;
	}

	.no-sprint p {
		margin: 0;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.no-sprint a {
		color: var(--ds-link, #669df1);
	}

	.board-scroll {
		flex: 1;
		overflow: auto;
		padding: 4px 16px 16px;
	}

	.column-headers {
		display: grid;
		gap: 8px;
	}

	.issue-panel {
		width: 480px;
		flex: none;
		border-left: 1px solid var(--ds-border, #3b3d42);
		background-color: var(--ds-surface, #1f1f21);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
</style>
