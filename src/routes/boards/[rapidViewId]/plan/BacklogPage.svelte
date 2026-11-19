<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { page } from "$app/state";
	import { onDestroy } from "svelte";
	import type { BoardIssue, Sprint } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import BoardShell from "#lib/boards/BoardShell.svelte";
	import BacklogRow from "#lib/boards/dnd/BacklogRow.svelte";
	import CategoryPills from "#lib/boards/dnd/CategoryPills.svelte";
	import DropZone from "#lib/boards/dnd/DropZone.svelte";
	import { BACKLOG_ACCEPT } from "#lib/boards/dnd/board-dnd.ts";
	import type { KeyboardDirection } from "#lib/boards/dnd/keyboard.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Button from "#lib/components/Button.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import { calendarDateTime } from "#lib/dates.ts";
	import IssueDetailView from "#lib/issue/IssueDetailView.svelte";
	import IssueUnavailable from "#lib/issue/IssueUnavailable.svelte";
	import { openCreateIssue } from "#lib/shell/CreateIssue.svelte";
	import BacklogPanels from "./BacklogPanels.svelte";
	import CreateSprintDialog from "./CreateSprintDialog.svelte";
	import DeleteSprintDialog from "./DeleteSprintDialog.svelte";
	import EditSprintDialog from "./EditSprintDialog.svelte";
	import InlineCreate from "./InlineCreate.svelte";
	import SprintMenu from "./SprintMenu.svelte";
	import StartSprintDialog from "./StartSprintDialog.svelte";
	import type { PageData } from "./$types";
	import type { BacklogPageData } from "./types.ts";

	type BacklogState = Omit<BacklogPageData, "sprintPermissions">;

	let { data }: { data: Extract<PageData, { missing: false }> } = $props();

	let rapidViewId = $derived(data.backlog.board.rapidViewId);

	let quickFilters = $derived(
		(page.url.searchParams.get("quickFilter") ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	);
	let text = $state(page.url.searchParams.get("text") ?? "");
	let lastUrlText = $state(page.url.searchParams.get("text") ?? "");
	let textTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(textTimer));
	let assignee = $derived(
		page.url.searchParams.get("assignee")?.trim() || null,
	);
	let epic = $derived(
		page.url.searchParams.get("epic")?.trim().toUpperCase() || null,
	);
	let version = $derived(page.url.searchParams.get("version")?.trim() || null);
	let selected = $state<Set<string>>(new Set());
	let lastIndex = $state<number | null>(null);
	let collapsed = $state<Set<string>>(new Set());
	let editingSprint = $state<Sprint | null>(null);
	let startingSprint = $state<Sprint | null>(null);
	let deletingSprint = $state<Sprint | null>(null);
	let createSprintOpen = $state(false);
	let actionError = $state<string | null>(null);
	let dragging = $state(false);
	let optimistic = $state<BacklogState | null>(null);
	let keyboardKey = $state<string | null>(null);
	let moveGeneration = 0;
	let moveQueue: Promise<void> = Promise.resolve();

	let current = $derived<BacklogState>(optimistic ?? data.backlog);
	let rows = $derived([
		...current.sprints.flatMap((sprint) => sprint.issues),
		...current.backlog.issues,
	]);
	let firstFuture = $derived(
		current.sprints.find((sprint) => sprint.state === "future"),
	);
	let assignees = $derived(data.assignees);

	$effect(() => {
		const next = page.url.searchParams.get("text") ?? "";
		if (next !== lastUrlText) {
			lastUrlText = next;
			if (next !== text) text = next;
		}
	});

	function updateParams(patch: Record<string, string | null>) {
		const url = new URL(page.url.href);
		for (const [key, value] of Object.entries(patch)) {
			if (value === null || value === "") url.searchParams.delete(key);
			else url.searchParams.set(key, value);
		}
		optimistic = null;
		void goto(`${url.pathname}${url.search}${url.hash}`, {
			replace: true,
			reset: false,
		});
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
		const next = quickFilters.includes(id)
			? quickFilters.filter((item) => item !== id)
			: [...quickFilters, id];
		updateParams({ quickFilter: next.length > 0 ? next.join(",") : null });
	}

	function toggleAssignee(username: string) {
		updateParams({ assignee: assignee === username ? null : username });
	}

	function errorMessage(cause: unknown) {
		return cause instanceof Error ? cause.message : "Something went wrong";
	}

	async function refresh() {
		await invalidate("app:board-backlog");
		optimistic = null;
	}

	function totalsFor(issues: BoardIssue[]) {
		const totals = { new: 0, indeterminate: 0, done: 0 };
		for (const issue of issues) {
			totals[issue.status.category] += issue.estimate ?? 0;
		}
		return totals;
	}

	function recompute(next: BacklogState) {
		for (const sprint of next.sprints) {
			sprint.totals = totalsFor(sprint.issues);
		}
		next.backlog.totals = totalsFor(next.backlog.issues);
		const all = [
			...next.sprints.flatMap((sprint) => sprint.issues),
			...next.backlog.issues,
		];
		for (const item of next.epics) {
			item.issueCount = all.filter(
				(issue) => issue.epic?.key === item.key,
			).length;
			item.doneCount = all.filter(
				(issue) =>
					issue.epic?.key === item.key && issue.status.category === "done",
			).length;
		}
	}

	function applyMove(
		next: BacklogState,
		keys: string[],
		target: { sprintId?: string | null; before?: string; epic?: string },
	) {
		const keySet = new Set(keys);
		if (target.epic !== undefined) {
			const epicRef = next.epics.find((item) => item.key === target.epic);
			const all = [
				...next.sprints.flatMap((sprint) => sprint.issues),
				...next.backlog.issues,
			];
			for (const issue of all) {
				if (!keySet.has(issue.key)) continue;
				issue.epic = epicRef
					? {
							key: epicRef.key,
							summary: epicRef.summary,
							colour: epicRef.colour,
						}
					: null;
			}
			return;
		}

		const moved: BoardIssue[] = [];
		for (const sprint of next.sprints) {
			sprint.issues = sprint.issues.filter((issue) => {
				if (!keySet.has(issue.key)) return true;
				moved.push(issue);
				return false;
			});
		}
		next.backlog.issues = next.backlog.issues.filter((issue) => {
			if (!keySet.has(issue.key)) return true;
			moved.push(issue);
			return false;
		});

		let list = next.backlog.issues;
		if (target.sprintId) {
			const sprint = next.sprints.find(
				(item) => item.id === target.sprintId,
			);
			if (sprint) list = sprint.issues;
		}
		for (const issue of moved) {
			issue.sprintId = target.sprintId ?? null;
		}
		const index = target.before
			? list.findIndex((issue) => issue.key === target.before)
			: -1;
		if (index >= 0) list.splice(index, 0, ...moved);
		else list.push(...moved);
	}

	async function moveKeys(
		keys: string[],
		target: { sprintId?: string | null; before?: string; epic?: string },
	) {
		if (keys.length === 0) return;
		const generation = ++moveGeneration;
		const next = structuredClone(
			$state.snapshot(current),
		) as BacklogState;
		applyMove(next, keys, target);
		recompute(next);
		optimistic = next;

		const request = moveQueue.then(() =>
			api(`/api/boards/${rapidViewId}/move`, {
				method: "POST",
				body: JSON.stringify({
					issues: keys,
					...(target.sprintId !== undefined
						? { sprintId: target.sprintId }
						: {}),
					...(target.before !== undefined
						? { before: target.before }
						: {}),
					...(target.epic !== undefined ? { epic: target.epic } : {}),
				}),
			}),
		);
		moveQueue = request.then(
			() => undefined,
			() => undefined,
		);
		try {
			await request;
		} catch (cause) {
			if (generation !== moveGeneration) return;
			optimistic = null;
			actionError = errorMessage(cause);
			return;
		}
		if (generation !== moveGeneration) return;

		actionError = null;
		selected = new Set();
		try {
			await refresh();
		} catch (cause) {
			optimistic = null;
			actionError = errorMessage(cause);
		}
	}

	async function moveSprint(sprint: Sprint, direction: "up" | "down") {
		try {
			await api(`/api/sprints/${sprint.id}/move`, {
				method: "POST",
				body: JSON.stringify({ direction }),
			});
			actionError = null;
			await refresh();
		} catch (cause) {
			actionError = errorMessage(cause);
		}
	}

	function startCreate(target: string | "backlog") {
		const sprintId = target === "backlog" ? null : target;
		const projectKey = current.board.project?.key;
		openCreateIssue(
			projectKey ? { projectKey } : {},
			{ onCreated: (key) => void moveCreated(key, sprintId) },
		);
	}

	async function moveCreated(key: string, sprintId: string | null) {
		try {
			await api(`/api/boards/${rapidViewId}/move`, {
				method: "POST",
				body: JSON.stringify({ issues: [key], sprintId }),
			});
			actionError = null;
			await refresh();
		} catch (cause) {
			actionError = errorMessage(cause);
		}
	}

	function rowClick(
		index: number,
		key: string,
		event: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean },
	) {
		if (event.shiftKey && lastIndex !== null) {
			const start = Math.min(lastIndex, index);
			const end = Math.max(lastIndex, index);
			selected = new Set(
				rows.slice(start, end + 1).map((row) => row.key),
			);
		} else if (event.ctrlKey || event.metaKey) {
			const next = new Set(selected);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			selected = next;
		} else {
			selected = new Set([key]);
		}
		lastIndex = index;
	}

	function dragKeys(key: string) {
		if (selected.has(key)) {
			return rows
				.filter((row) => selected.has(row.key))
				.map((row) => row.key);
		}
		return [key];
	}

	function toggleCollapsed(id: string) {
		const next = new Set(collapsed);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		collapsed = next;
	}

	function stateAppearance(state: Sprint["state"]) {
		if (state === "active") return "success" as const;
		if (state === "closed") return "default" as const;
		return "moved" as const;
	}

	function formatSprintRange(start: string | null, end: string | null) {
		if (!start && !end) return "";
		const startText = start ? calendarDateTime(start) : "?";
		const endText = end ? calendarDateTime(end) : "?";
		return `${startText} - ${endText}`;
	}

	function issueCountText(count: number) {
		return `${count} ${count === 1 ? "issue" : "issues"}`;
	}

	function containerFor(key: string) {
		for (const sprint of current.sprints) {
			const index = sprint.issues.findIndex((issue) => issue.key === key);
			if (index >= 0) {
				return { sprintId: sprint.id, issues: sprint.issues, index };
			}
		}
		const index = current.backlog.issues.findIndex(
			(issue) => issue.key === key,
		);
		if (index >= 0) {
			return { sprintId: null, issues: current.backlog.issues, index };
		}
		return null;
	}

	function keyboardLift(key: string) {
		keyboardKey = key;
		selected = new Set([key]);
		lastIndex = rows.findIndex((row) => row.key === key);
	}

	function keyboardMove(key: string, direction: KeyboardDirection) {
		const container = containerFor(key);
		if (!container) return;
		if (direction === "up") {
			const before = container.issues[container.index - 1]?.key;
			if (before) {
				void moveKeys([key], { sprintId: container.sprintId, before });
			}
			return;
		}
		if (direction === "down") {
			const next = container.issues[container.index + 1];
			if (!next) return;
			const after = container.issues[container.index + 2]?.key;
			void moveKeys([key], {
				sprintId: container.sprintId,
				...(after ? { before: after } : {}),
			});
			return;
		}
		if (direction === "left") {
			void moveKeys([key], { sprintId: null });
			return;
		}
		if (firstFuture) void moveKeys([key], { sprintId: firstFuture.id });
	}

	function keyboardDrop() {
		keyboardKey = null;
	}

	function keyboardCancel() {
		keyboardKey = null;
	}

	function planningUrl(selectedIssue?: string | null) {
		const params = new URLSearchParams(page.url.search);
		params.set("rapidView", String(rapidViewId));
		params.set("view", "planning");
		if (selectedIssue) params.set("selectedIssue", selectedIssue);
		else params.delete("selectedIssue");
		return `/secure/RapidBoard.jspa?${params.toString()}`;
	}

	function openIssue(key: string) {
		void goto(planningUrl(key), { reset: false });
	}

	function closeIssue() {
		void goto(planningUrl(), {
			replace: true,
			reset: false,
		});
	}

	function dialogDone(close: () => void) {
		close();
		return refresh();
	}
</script>

<BoardShell board={current.board} sidebar={data.sidebar} active="backlog">
	<div class="backlog-page">
		<div class="board-header">
			<div class="board-name">{current.board.name}</div>
			<h1>Backlog</h1>
		</div>
		<div class="board-toolbar">
			<span class="qf-label">QUICK FILTERS:</span>
			{#each current.quickFilters as filter (filter.id)}
				<button
					type="button"
					class="subtle"
					class:selected={quickFilters.includes(filter.id)}
					aria-pressed={quickFilters.includes(filter.id)}
					onclick={() => toggleQuickFilter(filter.id)}
				>
					{filter.name}
				</button>
			{/each}
			{#if assignees.length > 0}
				<span class="assignees" title="Filter by assignee">
					{#each assignees.slice(0, 12) as user (user.username)}
						<button
							type="button"
							title={user.displayName}
							aria-label={`Filter by ${user.displayName}`}
							aria-pressed={assignee === user.username}
							class:selected={assignee === user.username}
							class="assignee"
							onclick={() => toggleAssignee(user.username)}
						>
							<Avatar user={user} size={22} />
						</button>
					{/each}
				</span>
			{/if}
			<input
				type="search"
				aria-label="Search board"
				placeholder="Search board"
				bind:value={() => text, (value) => onText(value)}
			/>
			{#if current.board.type === "kanban" && current.board.kanbanBacklogStatus}
				<span class="muted"
					>Backlog: {current.board.kanbanBacklogStatus.name}</span
				>
			{/if}
		</div>

		{#if actionError}
			<div class="alert" role="alert">{actionError}</div>
		{/if}

		<div class="backlog-main">
			<div class="backlog-scroll">
				{#each current.sprints as sprint (sprint.id)}
					{@const isCollapsed = collapsed.has(sprint.id)}
					<DropZone
						kind="board-column"
						active={dragging}
						accept={BACKLOG_ACCEPT}
						testId={`backlog-sprint-section-${sprint.id}`}
						onDrop={(keys) =>
							void moveKeys(keys, { sprintId: sprint.id })}
						class="sprint-drop"
					>
						<div class="sprint-header" class:collapsed={isCollapsed}>
							<button
								type="button"
								class="collapse"
								aria-label={isCollapsed ? "Expand sprint" : "Collapse sprint"}
								aria-expanded={!isCollapsed}
								onclick={() => toggleCollapsed(sprint.id)}
							>
								<span class="chevron" class:collapsed={isCollapsed}>
									<Icon name="chevron-down" />
								</span>
							</button>
							<span class="sprint-name">{sprint.name}</span>
							<span class="muted">{issueCountText(sprint.issues.length)}</span>
							<Lozenge appearance={stateAppearance(sprint.state)}>
								{sprint.state === "active" ? "Active" : "Future"}
							</Lozenge>
							<span class="muted">
								{formatSprintRange(sprint.startDate, sprint.endDate)}
							</span>
							{#if data.sprintPermissions.startStop && firstFuture?.id === sprint.id}
								<Button
									spacing="compact"
									onclick={() => (startingSprint = sprint)}
								>
									Start sprint
								</Button>
							{/if}
							<span class="sprint-actions">
								<CategoryPills totals={sprint.totals} />
								<SprintMenu
									{sprint}
									canEdit={data.sprintPermissions.editText}
									canManage={data.sprintPermissions.manage}
									onEdit={() => (editingSprint = sprint)}
									onDelete={() => (deletingSprint = sprint)}
									onMove={(direction) =>
										void moveSprint(sprint, direction)}
								/>
							</span>
						</div>
						{#if !isCollapsed}
							<div>
								{#each sprint.issues as issue (issue.key)}
									{@const index = rows.findIndex(
										(row) => row.key === issue.key,
									)}
									<BacklogRow
										{issue}
										estimationField={current.board.estimationField}
										selected={selected.has(issue.key)}
										dragKeys={dragKeys(issue.key)}
										onClick={(event) => {
											rowClick(index, issue.key, event);
											if (
												!event.ctrlKey &&
												!event.shiftKey &&
												!event.metaKey
											) {
												openIssue(issue.key);
											}
										}}
										onOpen={() => openIssue(issue.key)}
										onDragStart={() => (dragging = true)}
										onDragEnd={() => (dragging = false)}
										onDropBefore={(keys) =>
											void moveKeys(keys, {
												sprintId: sprint.id,
												before: issue.key,
											})}
										keyboardActive={keyboardKey === issue.key}
										onKeyboardLift={() => keyboardLift(issue.key)}
										onKeyboardMove={(direction) =>
											keyboardMove(issue.key, direction)}
										onKeyboardDrop={keyboardDrop}
										onKeyboardCancel={keyboardCancel}
									/>
								{/each}
								<InlineCreate
									onClick={() => startCreate(sprint.id)}
								/>
							</div>
						{/if}
					</DropZone>
				{/each}

				{#if current.board.type === "scrum" && data.sprintPermissions.manage}
					<div class="create-sprint">
						<Button
							spacing="compact"
							onclick={() => (createSprintOpen = true)}
						>
							Create sprint
						</Button>
					</div>
				{/if}

				<DropZone
					kind="board-column"
					active={dragging}
					accept={BACKLOG_ACCEPT}
					testId="backlog-container"
					onDrop={(keys) => void moveKeys(keys, { sprintId: null })}
					class="backlog-drop"
				>
					<div class="backlog-header">
						<span class="sprint-name">
							{current.board.type === "kanban"
								? "Kanban backlog"
								: "Backlog"}
						</span>
						<span class="muted">
							{issueCountText(current.backlog.issues.length)}
						</span>
						<span class="backlog-actions">
							<CategoryPills totals={current.backlog.totals} />
						</span>
					</div>
					{#each current.backlog.issues as issue (issue.key)}
						{@const index = rows.findIndex(
							(row) => row.key === issue.key,
						)}
						<BacklogRow
							{issue}
							estimationField={current.board.estimationField}
							selected={selected.has(issue.key)}
							dragKeys={dragKeys(issue.key)}
							onClick={(event) => {
								rowClick(index, issue.key, event);
								if (!event.ctrlKey && !event.shiftKey && !event.metaKey) {
									openIssue(issue.key);
								}
							}}
							onOpen={() => openIssue(issue.key)}
							onDragStart={() => (dragging = true)}
							onDragEnd={() => (dragging = false)}
							onDropBefore={(keys) =>
								void moveKeys(keys, {
									sprintId: null,
									before: issue.key,
								})}
							keyboardActive={keyboardKey === issue.key}
							onKeyboardLift={() => keyboardLift(issue.key)}
							onKeyboardMove={(direction) =>
								keyboardMove(issue.key, direction)}
							onKeyboardDrop={keyboardDrop}
							onKeyboardCancel={keyboardCancel}
						/>
					{/each}
					<InlineCreate onClick={() => startCreate("backlog")} />
				</DropZone>
			</div>

			<BacklogPanels
				data={current}
				{epic}
				{version}
				onEpic={(key) => updateParams({ epic: key })}
				onVersion={(id) => updateParams({ version: id })}
				onEpicDrop={(epicKey, keys) =>
					void moveKeys(keys, { epic: epicKey })}
			/>
		</div>
	</div>

	{#if data.selectedIssue}
		<aside class="issue-panel">
			{#if data.issue}
				{#key data.issue.issue.key}
					<IssueDetailView view={data.issue} narrow onClose={closeIssue} />
				{/key}
			{:else}
				<IssueUnavailable />
			{/if}
		</aside>
	{/if}

	{#if createSprintOpen}
		<CreateSprintDialog
			{rapidViewId}
			onClose={() => (createSprintOpen = false)}
			onDone={() => dialogDone(() => (createSprintOpen = false))}
		/>
	{/if}

	{#if editingSprint}
		<EditSprintDialog
			sprint={editingSprint}
			{rapidViewId}
			canEditText={data.sprintPermissions.editText}
			canManage={data.sprintPermissions.manage}
			onClose={() => (editingSprint = null)}
			onDone={() => dialogDone(() => (editingSprint = null))}
		/>
	{/if}

	{#if startingSprint}
		<StartSprintDialog
			sprint={startingSprint}
			{rapidViewId}
			canEditText={data.sprintPermissions.editText}
			onClose={() => (startingSprint = null)}
			onDone={() => dialogDone(() => (startingSprint = null))}
		/>
	{/if}

	{#if deletingSprint}
		<DeleteSprintDialog
			sprint={deletingSprint}
			{rapidViewId}
			onClose={() => (deletingSprint = null)}
			onDone={() => dialogDone(() => (deletingSprint = null))}
		/>
	{/if}
</BoardShell>

<style>
	.backlog-page {
		flex: 1;
		min-width: 0;
		height: calc(100vh - 56px);
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.board-header {
		padding: 10px 16px 6px;
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
	}

	.board-toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		padding: 6px 16px 8px;
		border-bottom: 1px solid var(--ds-border);
	}

	.qf-label {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.4px;
		color: var(--ds-text-subtle);
	}

	.subtle {
		padding: 0 6px;
		height: 24px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		font-size: 13px;
		cursor: pointer;
	}

	.subtle.selected {
		color: var(--ds-link);
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

	.assignee.selected {
		border-color: var(--ds-border-selected);
	}

	.board-toolbar input[type="search"] {
		margin-left: auto;
		width: 200px;
		height: 28px;
		padding: 0 8px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 13px;
	}

	.muted {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.alert {
		margin: 8px 16px 0;
		padding: 6px 10px;
		border: 1px solid #e5493a;
		border-radius: 3px;
		color: #e5493a;
		font-size: 13px;
	}

	.backlog-main {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	.backlog-scroll {
		flex: 1;
		min-width: 0;
		overflow: auto;
		padding: 8px 16px 24px;
	}

	:global(.sprint-drop) {
		margin-bottom: 8px;
		background-color: var(--ds-surface-sunken);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
	}

	:global(.backlog-drop) {
		background-color: var(--ds-surface-sunken);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
	}

	.sprint-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
	}

	.sprint-header:not(.collapsed) {
		border-bottom: 1px solid var(--ds-border);
	}

	.collapse {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		height: 24px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}

	.chevron {
		display: inline-flex;
	}

	.chevron.collapsed {
		transform: rotate(-90deg);
	}

	.sprint-name {
		font-weight: 600;
	}

	.sprint-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.backlog-actions {
		margin-left: auto;
	}

	.create-sprint {
		margin: 8px 0;
	}

	.backlog-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--ds-border);
	}

	.issue-panel {
		width: 480px;
		flex: none;
		border-left: 1px solid var(--ds-border);
		background-color: var(--ds-surface);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
</style>
