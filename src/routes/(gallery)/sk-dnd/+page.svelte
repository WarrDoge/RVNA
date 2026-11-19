<script lang="ts">
	import { tick } from "svelte";
	import type { BoardIssue, StatusRef } from "#lib/api-types.ts";
	import {
		BACKLOG_ACCEPT,
		cssStyle,
	} from "#lib/boards/dnd/board-dnd.ts";
	import BacklogRow from "#lib/boards/dnd/BacklogRow.svelte";
	import BoardCard from "#lib/boards/dnd/BoardCard.svelte";
	import CategoryPills from "#lib/boards/dnd/CategoryPills.svelte";
	import {
		createDemoBacklog,
		createDemoColumns,
		createDemoLanes,
		createDemoSprints,
		type DemoLane,
		type DemoSprint,
		estimateTotals,
	} from "#lib/boards/dnd/demo-data.ts";
	import * as styles from "#lib/boards/dnd/demo-styles.ts";
	import DropIndicator from "#lib/boards/dnd/DropIndicator.svelte";
	import DropZone from "#lib/boards/dnd/DropZone.svelte";
	import {
		dropIndicatorMonitor,
		type DropIndicatorTarget,
	} from "#lib/boards/dnd/drop-indicator.ts";
	import type { KeyboardDirection } from "#lib/boards/dnd/keyboard.ts";
	import Lozenge from "#lib/components/Lozenge.svelte";

	type BoardKeyboard = {
		kind: "board";
		keys: string[];
		laneId: string;
		columnId: string;
	};

	type BacklogKeyboard = {
		kind: "backlog";
		keys: string[];
	};

	type KeyboardState = BoardKeyboard | BacklogKeyboard;

	const demoColumns = createDemoColumns();
	let lanes = $state(createDemoLanes(demoColumns));
	let sprints = $state(createDemoSprints());
	let backlog = $state(createDemoBacklog());

	let dragging = $state(false);
	let selectedBoardKey = $state<string | null>(null);
	let selectedRows = $state(new Set<string>());
	let lastRowIndex = $state<number | null>(null);
	let opened = $state<string | null>(null);
	let dropIndicator = $state<DropIndicatorTarget>(null);
	let keyboard = $state<KeyboardState | null>(null);
	let keyboardBoardSnapshot: DemoLane[] | null = null;
	let keyboardBacklogSnapshot: {
		sprints: DemoSprint[];
		backlog: BoardIssue[];
	} | null = null;

	let rows = $derived([...sprints.flatMap((sprint) => sprint.issues), ...backlog]);
	let boardKeyboardKey = $derived(
		keyboard?.kind === "board" ? keyboard.keys[0] : null,
	);
	let backlogKeyboardKey = $derived(
		keyboard?.kind === "backlog" ? keyboard.keys[0] : null,
	);

	const monitor = dropIndicatorMonitor((target) => {
		dropIndicator = target;
	});

	function findBoardCard(key: string) {
		for (const lane of lanes) {
			const index = lane.cards.findIndex((card) => card.key === key);
			if (index !== -1) return { lane, index, card: lane.cards[index] };
		}
		return null;
	}

	function columnFor(id: string | null | undefined) {
		return demoColumns.find((column) => column.id === id) ?? null;
	}

	function moveBoard(
		keys: string[],
		target: {
			laneId?: string;
			columnId?: string;
			status?: StatusRef;
			before?: string;
			after?: string;
		},
	) {
		const keySet = new Set(keys);
		let targetLaneId = target.laneId;
		if (target.before) {
			const found = lanes.find((lane) =>
				lane.cards.some((card) => card.key === target.before),
			);
			if (found) targetLaneId = found.id;
		}
		if (target.after) {
			const found = lanes.find((lane) =>
				lane.cards.some((card) => card.key === target.after),
			);
			if (found) targetLaneId = found.id;
		}
		if (!targetLaneId) return;

		const moved: BoardIssue[] = [];
		for (const lane of lanes) {
			lane.cards = lane.cards.filter((card) => {
				if (keySet.has(card.key)) {
					moved.push(card);
					return false;
				}
				return true;
			});
		}
		if (moved.length === 0) return;

		const targetLane = lanes.find((lane) => lane.id === targetLaneId);
		if (!targetLane) return;

		for (const card of moved) {
			const previousColumnId = card.columnId;
			if (target.columnId) card.columnId = target.columnId;
			if (target.status) {
				card.status = target.status;
			} else if (target.columnId && previousColumnId !== target.columnId) {
				const column = columnFor(target.columnId);
				if (column?.statuses[0]) card.status = column.statuses[0];
			}
		}

		if (target.before) {
			const index = targetLane.cards.findIndex(
				(card) => card.key === target.before,
			);
			targetLane.cards.splice(
				index < 0 ? targetLane.cards.length : index,
				0,
				...moved,
			);
		} else if (target.after) {
			const index = targetLane.cards.findIndex(
				(card) => card.key === target.after,
			);
			targetLane.cards.splice(
				index < 0 ? targetLane.cards.length : index + 1,
				0,
				...moved,
			);
		} else {
			targetLane.cards.push(...moved);
		}
		lanes = [...lanes];
	}

	function moveBacklog(
		keys: string[],
		target: {
			sprintId: string | null;
			before?: string;
			after?: string;
		},
	) {
		const keySet = new Set(keys);
		const moved: BoardIssue[] = [];
		for (const sprint of sprints) {
			sprint.issues = sprint.issues.filter((issue) => {
				if (keySet.has(issue.key)) {
					moved.push(issue);
					return false;
				}
				return true;
			});
		}
		backlog = backlog.filter((issue) => {
			if (keySet.has(issue.key)) {
				moved.push(issue);
				return false;
			}
			return true;
		});
		if (moved.length === 0) return;

		for (const issue of moved) issue.sprintId = target.sprintId;
		const targetIssues = target.sprintId
			? sprints.find((sprint) => sprint.id === target.sprintId)?.issues
			: backlog;
		if (!targetIssues) return;

		if (target.before) {
			const index = targetIssues.findIndex(
				(issue) => issue.key === target.before,
			);
			targetIssues.splice(
				index < 0 ? targetIssues.length : index,
				0,
				...moved,
			);
		} else if (target.after) {
			const index = targetIssues.findIndex(
				(issue) => issue.key === target.after,
			);
			targetIssues.splice(
				index < 0 ? targetIssues.length : index + 1,
				0,
				...moved,
			);
		} else {
			targetIssues.push(...moved);
		}
		sprints = [...sprints];
		backlog = [...backlog];
	}

	function openBoardIssue(key: string) {
		selectedBoardKey = key;
		opened = key;
	}

	function openBacklogIssue(key: string) {
		opened = key;
	}

	function rowClick(
		index: number,
		key: string,
		event: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean },
	) {
		if (event.shiftKey && lastRowIndex !== null) {
			const start = Math.min(lastRowIndex, index);
			const end = Math.max(lastRowIndex, index);
			selectedRows = new Set(
				rows.slice(start, end + 1).map((row) => row.key),
			);
		} else if (event.ctrlKey || event.metaKey) {
			const next = new Set(selectedRows);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			selectedRows = next;
		} else {
			selectedRows = new Set([key]);
		}
		lastRowIndex = index;
	}

	function dragKeys(key: string) {
		if (selectedRows.has(key)) {
			return rows.filter((row) => selectedRows.has(row.key)).map((row) => row.key);
		}
		return [key];
	}

	function isCardIndicator(key: string) {
		return dropIndicator?.kind === "card" && dropIndicator.key === key;
	}

	function isZoneIndicator(testId: string) {
		return dropIndicator?.kind === "zone" && dropIndicator.testId === testId;
	}

	async function focusBoardCard(key: string) {
		await tick();
		document
			.querySelector<HTMLElement>(`[data-testid="board-card-${key}"]`)
			?.focus();
	}

	async function focusBacklogRow(key: string) {
		await tick();
		document
			.querySelector<HTMLElement>(`[data-testid="backlog-row-${key}"]`)
			?.focus();
	}

	function liftBoard(key: string) {
		const found = findBoardCard(key);
		if (!found) return;
		keyboardBoardSnapshot = $state.snapshot(lanes) as DemoLane[];
		keyboard = {
			kind: "board",
			keys: [key],
			laneId: found.lane.id,
			columnId: found.card.columnId ?? demoColumns[0].id,
		};
		selectedBoardKey = key;
		opened = key;
	}

	function moveBoardKeyboard(key: string, direction: KeyboardDirection) {
		if (!keyboard || keyboard.kind !== "board") return;
		const found = findBoardCard(key);
		if (!found) return;
		const laneId = found.lane.id;
		const columnId = found.card.columnId ?? demoColumns[0].id;
		const columnIndex = demoColumns.findIndex(
			(column) => column.id === columnId,
		);
		if (direction === "left" || direction === "right") {
			const nextColumn =
				demoColumns[columnIndex + (direction === "left" ? -1 : 1)];
			if (!nextColumn) return;
			moveBoard([key], { laneId, columnId: nextColumn.id });
			keyboard = { ...keyboard, laneId, columnId: nextColumn.id };
			void focusBoardCard(key);
			return;
		}
		const cards = found.lane.cards.filter(
			(card) => card.columnId === columnId,
		);
		const index = cards.findIndex((card) => card.key === key);
		const target =
			direction === "up" ? cards[index - 1] : cards[index + 1];
		if (!target) return;
		moveBoard([key], {
			laneId,
			columnId,
			...(direction === "up"
				? { before: target.key }
				: { after: target.key }),
		});
		void focusBoardCard(key);
	}

	function liftBacklog(key: string) {
		const issue = rows.find((row) => row.key === key);
		if (!issue) return;
		keyboardBacklogSnapshot = {
			sprints: $state.snapshot(sprints) as DemoSprint[],
			backlog: $state.snapshot(backlog) as BoardIssue[],
		};
		keyboard = { kind: "backlog", keys: [key] };
		selectedRows = new Set([key]);
		opened = key;
	}

	function backlogSection(key: string) {
		for (const sprint of sprints) {
			const index = sprint.issues.findIndex((issue) => issue.key === key);
			if (index !== -1) {
				return { sprintId: sprint.id, issues: sprint.issues, index };
			}
		}
		const index = backlog.findIndex((issue) => issue.key === key);
		if (index !== -1) return { sprintId: null, issues: backlog, index };
		return null;
	}

	function moveBacklogKeyboard(key: string, direction: KeyboardDirection) {
		if (!keyboard || keyboard.kind !== "backlog") return;
		const section = backlogSection(key);
		if (!section) return;
		if (direction === "left" || direction === "right") {
			const sectionIds: (string | null)[] = [
				...sprints.map((sprint) => sprint.id),
				null,
			];
			const current = sectionIds.indexOf(section.sprintId);
			const next = sectionIds[current + (direction === "left" ? -1 : 1)];
			if (next === undefined) return;
			moveBacklog([key], { sprintId: next });
			void focusBacklogRow(key);
			return;
		}
		const target =
			direction === "up"
				? section.issues[section.index - 1]
				: section.issues[section.index + 1];
		if (!target) return;
		moveBacklog([key], {
			sprintId: section.sprintId,
			...(direction === "up"
				? { before: target.key }
				: { after: target.key }),
		});
		void focusBacklogRow(key);
	}

	function dropKeyboard() {
		keyboard = null;
		keyboardBoardSnapshot = null;
		keyboardBacklogSnapshot = null;
	}

	function cancelKeyboard() {
		const kind = keyboard?.kind;
		const key = keyboard?.keys[0];
		if (kind === "board" && keyboardBoardSnapshot) {
			lanes = keyboardBoardSnapshot;
		}
		if (kind === "backlog" && keyboardBacklogSnapshot) {
			sprints = keyboardBacklogSnapshot.sprints;
			backlog = keyboardBacklogSnapshot.backlog;
		}
		keyboard = null;
		keyboardBoardSnapshot = null;
		keyboardBacklogSnapshot = null;
		if (kind === "board" && key) void focusBoardCard(key);
		if (kind === "backlog" && key) void focusBacklogRow(key);
	}
</script>

<svelte:head>
	<title>Drag and drop gallery - RVNA</title>
</svelte:head>

<main class="sk-dnd" style={cssStyle(styles.pageStyle)} {@attach monitor}>
	<header style={cssStyle(styles.headerStyle)}>
		<h1 style={cssStyle(styles.titleStyle)}>Drag and drop gallery</h1>
		<p style={cssStyle(styles.subtitleStyle)}>
			Board and backlog demo with invented data. Temporary.
		</p>
		<span
			data-testid="dnd-opened"
			aria-live="polite"
			style="margin-left: auto; font-size: 12px; color: var(--ds-text-subtle, #a9abaf);"
		>
			{opened ? `Opened ${opened}` : ""}
		</span>
	</header>

	<div style={cssStyle(styles.layoutStyle)}>
		<section style={cssStyle(styles.sectionStyle)} aria-labelledby="board-heading">
			<h2 id="board-heading" style={cssStyle(styles.sectionTitleStyle)}>Board</h2>
			{#each lanes as lane (lane.id)}
				<section
					style={cssStyle(styles.laneStyle)}
					data-testid={`board-lane-${lane.id}`}
					data-lane-id={lane.id}
				>
					<div style={cssStyle(styles.laneHeaderStyle)}>
						<span>{lane.name}</span>
						<span style={cssStyle(styles.laneCountStyle)}>
							{lane.cards.length} issues
						</span>
					</div>
					<div style={cssStyle(styles.columnsStyle)}>
						{#each demoColumns as column (column.id)}
							{const zoneTestId = `board-column-${lane.id}-${column.id}`}
							{const columnIssues = $derived(
								lane.cards.filter((issue) => issue.columnId === column.id),
							)}
							<DropZone
								kind="board-column"
								columnId={column.id}
								testId={zoneTestId}
								active={dragging}
								onDrop={(keys) =>
									moveBoard(keys, { laneId: lane.id, columnId: column.id })}
								style={styles.columnZoneStyle}
							>
								<DropIndicator
									active={isZoneIndicator(zoneTestId)}
									testId={`drop-indicator-${zoneTestId}`}
								/>
								<div style={cssStyle(styles.columnHeaderStyle)}>
									<span>{column.name}</span>
									<span style={cssStyle(styles.columnCountStyle)}>
										{columnIssues.length}
									</span>
								</div>
								{#each columnIssues as issue (issue.key)}
									{const cardTestId = `board-card-${issue.key}`}
									<div style={cssStyle(styles.cardSlotStyle)}>
										<DropIndicator
											active={isCardIndicator(issue.key) ||
												boardKeyboardKey === issue.key}
											testId={`drop-indicator-${cardTestId}`}
										/>
										<BoardCard
											{issue}
											estimationField="story_points"
											cardColourStrategy="none"
											selected={selectedBoardKey === issue.key}
											onOpen={() => openBoardIssue(issue.key)}
											onDragStart={() => (dragging = true)}
											onDragEnd={() => (dragging = false)}
											onDropBefore={(keys) =>
												moveBoard(keys, {
													columnId: issue.columnId ?? undefined,
													before: issue.key,
												})}
											keyboardActive={boardKeyboardKey === issue.key}
											onKeyboardLift={() => liftBoard(issue.key)}
											onKeyboardMove={(direction) =>
												moveBoardKeyboard(issue.key, direction)}
											onKeyboardDrop={dropKeyboard}
											onKeyboardCancel={cancelKeyboard}
										/>
									</div>
								{/each}
								{#if columnIssues.length === 0 && !dragging}
									<div style={cssStyle(styles.emptyStyle)}>No issues</div>
								{/if}
								{#if dragging && column.statuses.length > 1}
									<div style="margin-top: 4px;">
										{#each column.statuses as status (status.id)}
											{const statusTestId = `board-status-${lane.id}-${column.id}-${status.id}`}
											<DropZone
												kind="board-status"
												columnId={column.id}
												statusId={status.id}
												active={dragging}
												label={status.name}
												testId={statusTestId}
												onDrop={(keys) =>
													moveBoard(keys, {
														laneId: lane.id,
														columnId: column.id,
														status,
													})}
												style="position: relative; margin-bottom: 4px; padding: 4px; border-radius: 3px;"
											>
												<DropIndicator
													active={isZoneIndicator(statusTestId)}
													testId={`drop-indicator-${statusTestId}`}
												/>
											</DropZone>
										{/each}
									</div>
								{/if}
							</DropZone>
						{/each}
					</div>
				</section>
			{/each}
		</section>

		<section
			style={cssStyle(styles.sectionStyle)}
			aria-labelledby="backlog-heading"
		>
			<h2 id="backlog-heading" style={cssStyle(styles.sectionTitleStyle)}>
				Backlog
			</h2>
			{#each sprints as sprint (sprint.id)}
				{const sprintTestId = `backlog-sprint-section-${sprint.id}`}
				{const totals = $derived(estimateTotals(sprint.issues))}
				<DropZone
					kind="board-column"
					active={dragging}
					accept={BACKLOG_ACCEPT}
					testId={sprintTestId}
					onDrop={(keys) => moveBacklog(keys, { sprintId: sprint.id })}
					style={styles.backlogSprintZoneStyle}
				>
					<DropIndicator
						active={isZoneIndicator(sprintTestId)}
						testId={`drop-indicator-${sprintTestId}`}
					/>
					<div style={cssStyle(styles.backlogHeaderStyle)}>
						<span style={cssStyle(styles.sprintNameStyle)}>{sprint.name}</span>
						<span style={cssStyle(styles.metaStyle)}>
							{sprint.issues.length} issues
						</span>
						<Lozenge appearance={sprint.state === "active" ? "success" : "default"}>
							{sprint.state === "active" ? "Active" : "Future"}
						</Lozenge>
						<span style={cssStyle(styles.headerRightStyle)}>
							<CategoryPills {totals} />
						</span>
					</div>
					{#each sprint.issues as issue (issue.key)}
						{const rowTestId = `backlog-row-${issue.key}`}
						{const rowIndex = $derived(
							rows.findIndex((row) => row.key === issue.key),
						)}
						<div style={cssStyle(styles.cardSlotStyle)}>
							<DropIndicator
								active={isCardIndicator(issue.key) ||
									backlogKeyboardKey === issue.key}
								testId={`drop-indicator-${rowTestId}`}
							/>
							<BacklogRow
								{issue}
								estimationField="story_points"
								selected={selectedRows.has(issue.key)}
								dragKeys={dragKeys(issue.key)}
								onClick={(event) => rowClick(rowIndex, issue.key, event)}
								onOpen={() => openBacklogIssue(issue.key)}
								onDragStart={() => (dragging = true)}
								onDragEnd={() => (dragging = false)}
								onDropBefore={(keys) =>
									moveBacklog(keys, {
										sprintId: issue.sprintId,
										before: issue.key,
									})}
								keyboardActive={backlogKeyboardKey === issue.key}
								onKeyboardLift={() => liftBacklog(issue.key)}
								onKeyboardMove={(direction) =>
									moveBacklogKeyboard(issue.key, direction)}
								onKeyboardDrop={dropKeyboard}
								onKeyboardCancel={cancelKeyboard}
							/>
						</div>
					{/each}
				</DropZone>
			{/each}

			<DropZone
				kind="board-column"
				active={dragging}
				accept={BACKLOG_ACCEPT}
				testId="backlog-container"
				onDrop={(keys) => moveBacklog(keys, { sprintId: null })}
				style={styles.backlogListZoneStyle}
			>
				<DropIndicator
					active={isZoneIndicator("backlog-container")}
					testId="drop-indicator-backlog-container"
				/>
				<div style={cssStyle(styles.backlogHeaderStyle)}>
					<span style={cssStyle(styles.sprintNameStyle)}>Backlog</span>
					<span style={cssStyle(styles.metaStyle)}>
						{backlog.length} issues
					</span>
					<span style={cssStyle(styles.headerRightStyle)}>
						<CategoryPills totals={estimateTotals(backlog)} />
					</span>
				</div>
				{#each backlog as issue (issue.key)}
					{const rowTestId = `backlog-row-${issue.key}`}
					{const rowIndex = $derived(
						rows.findIndex((row) => row.key === issue.key),
					)}
					<div style={cssStyle(styles.cardSlotStyle)}>
						<DropIndicator
							active={isCardIndicator(issue.key) ||
								backlogKeyboardKey === issue.key}
							testId={`drop-indicator-${rowTestId}`}
						/>
						<BacklogRow
							{issue}
							estimationField="story_points"
							selected={selectedRows.has(issue.key)}
							dragKeys={dragKeys(issue.key)}
							onClick={(event) => rowClick(rowIndex, issue.key, event)}
							onOpen={() => openBacklogIssue(issue.key)}
							onDragStart={() => (dragging = true)}
							onDragEnd={() => (dragging = false)}
							onDropBefore={(keys) =>
								moveBacklog(keys, {
									sprintId: issue.sprintId,
									before: issue.key,
								})}
							keyboardActive={backlogKeyboardKey === issue.key}
							onKeyboardLift={() => liftBacklog(issue.key)}
							onKeyboardMove={(direction) =>
								moveBacklogKeyboard(issue.key, direction)}
							onKeyboardDrop={dropKeyboard}
							onKeyboardCancel={cancelKeyboard}
						/>
					</div>
				{/each}
			</DropZone>

			<p style={cssStyle(styles.hintStyle)}>
				Mouse: drag cards between columns and rows. Keyboard: focus a card or
				row, press Space, use the arrow keys, then Space to drop or Escape to
				cancel.
			</p>
		</section>
	</div>
</main>
