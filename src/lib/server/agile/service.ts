import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { z } from "zod";
import {
	customFieldId,
	resolveCustomFieldRoles,
} from "../../shared/custom-field-roles.ts";
import { JqlError, parseJql } from "../../shared/jql/index.ts";
import type { CurrentUser } from "../auth.ts";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import type { HistoryItem } from "../history.ts";
import { HttpError } from "../http.ts";
import { loadCatalog } from "../jql/catalog.ts";
import { compileJql, type SearchUser } from "../jql/compile.ts";
import { withStatementTimeout } from "../jql/timeout.ts";
import { recordIssueEvent } from "../notifications.ts";
import {
	can,
	type PermissionKey,
	projectForId,
	projectIdsWith,
	requireBrowseIssue,
	requireBrowseProject,
	requireIssuePermissionFor,
	viewerProjectIds,
} from "../permissions.ts";
import { ranksBetween } from "../rank.ts";
import {
	boardColumnStatuses,
	boardColumns,
	boardQuickFilters,
	boardSprints,
	boardSwimlanes,
	boards,
	fields,
	issueSprints,
	issues,
	issueTypes,
	projects,
	projectWorkflows,
	sprints,
	statuses,
	users,
	versions,
	workflowStatuses,
} from "../schema.ts";
import { recomputeIssueSla } from "../servicedesk/recompute.ts";
import { applyTransition } from "../transitions.ts";
import { transitionsFrom, workflowForIssueType } from "../workflows.ts";
import { waitForBoardMoves } from "./pending.ts";
import type {
	boardCreateBody,
	boardPatchBody,
	columnsBody,
	moveBody,
	quickFiltersBody,
	searchQuery,
	sprintCompleteBody,
	sprintCreateBody,
	sprintPatchBody,
	sprintStartBody,
	swimlanesBody,
} from "./schemas.ts";

type BoardRow = {
	id: string;
	rapidViewId: number;
	sourceId: string | null;
	name: string;
	type: "scrum" | "kanban";
	filterJql: string;
	projectId: string | null;
	projectKey: string | null;
	projectName: string | null;
	estimationField: "story_points" | "original_estimate" | "issue_count";
	swimlaneStrategy: "none" | "assignee" | "epic" | "queries";
	cardColourStrategy: "none" | "priority" | "assignee" | "epic" | "issue_type";
	subFilterJql: string | null;
	kanbanBacklogStatusId: string | null;
	ownerId: string | null;
	ownerUsername: string | null;
	ownerDisplayName: string | null;
	ownerAvatarUrl: string | null;
	configImported: boolean;
};

type StatusRow = {
	id: string;
	name: string;
	category: "new" | "indeterminate" | "done";
};

function userRef(row: {
	id: string | null;
	username: string | null;
	displayName: string | null;
	avatarUrl: string | null;
}) {
	if (!row.id || !row.username || !row.displayName) return null;
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		avatarUrl: row.avatarUrl,
	};
}

function iso(value: Date | null) {
	return value?.toISOString() ?? null;
}

function boardRef(row: BoardRow) {
	return {
		id: row.id,
		rapidViewId: row.rapidViewId,
		name: row.name,
		type: row.type,
		project:
			row.projectId && row.projectKey && row.projectName
				? { id: row.projectId, key: row.projectKey, name: row.projectName }
				: null,
		owner: userRef({
			id: row.ownerId,
			username: row.ownerUsername,
			displayName: row.ownerDisplayName,
			avatarUrl: row.ownerAvatarUrl,
		}),
		configImported: row.configImported,
	};
}

async function loadBoardRow(rapidViewId: number): Promise<BoardRow | null> {
	const [row] = await db
		.select({
			id: boards.id,
			rapidViewId: boards.rapidViewId,
			sourceId: boards.sourceId,
			name: boards.name,
			type: boards.type,
			filterJql: boards.filterJql,
			projectId: projects.id,
			projectKey: projects.key,
			projectName: projects.name,
			estimationField: boards.estimationField,
			swimlaneStrategy: boards.swimlaneStrategy,
			cardColourStrategy: boards.cardColourStrategy,
			subFilterJql: boards.subFilterJql,
			kanbanBacklogStatusId: boards.kanbanBacklogStatusId,
			ownerId: users.id,
			ownerUsername: users.username,
			ownerDisplayName: users.displayName,
			ownerAvatarUrl: userAvatarSql(users.id),
			configImported: boards.configImported,
		})
		.from(boards)
		.leftJoin(projects, eq(projects.id, boards.projectId))
		.leftJoin(users, eq(users.id, boards.ownerId))
		.where(eq(boards.rapidViewId, rapidViewId))
		.limit(1);
	return row ?? null;
}

async function loadStatuses(statusIds: string[]): Promise<StatusRow[]> {
	if (statusIds.length === 0) return [];
	return db
		.select({
			id: statuses.id,
			name: statuses.name,
			category: statuses.category,
		})
		.from(statuses)
		.where(inArray(statuses.id, statusIds));
}

async function statusesForProject(
	projectId: string | null,
	executor: typeof db | Transaction = db,
) {
	if (!projectId) return [];
	const rows = await executor
		.selectDistinct({
			id: statuses.id,
			name: statuses.name,
			category: statuses.category,
		})
		.from(projectWorkflows)
		.innerJoin(
			workflowStatuses,
			eq(workflowStatuses.workflowId, projectWorkflows.workflowId),
		)
		.innerJoin(statuses, eq(statuses.id, workflowStatuses.statusId))
		.where(eq(projectWorkflows.projectId, projectId))
		.orderBy(asc(statuses.name));
	if (rows.length > 0) return rows;
	return executor
		.selectDistinct({
			id: statuses.id,
			name: statuses.name,
			category: statuses.category,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.where(eq(issues.projectId, projectId))
		.orderBy(asc(statuses.name));
}

async function loadBoardConfig(rapidViewId: number) {
	const board = await loadBoardRow(rapidViewId);
	if (!board) return null;

	const [columnRows, swimlaneRows, quickFilterRows] = await Promise.all([
		db
			.select()
			.from(boardColumns)
			.where(eq(boardColumns.boardId, board.id))
			.orderBy(asc(boardColumns.sequence), asc(boardColumns.name)),
		db
			.select()
			.from(boardSwimlanes)
			.where(eq(boardSwimlanes.boardId, board.id))
			.orderBy(asc(boardSwimlanes.sequence), asc(boardSwimlanes.name)),
		db
			.select()
			.from(boardQuickFilters)
			.where(eq(boardQuickFilters.boardId, board.id))
			.orderBy(asc(boardQuickFilters.sequence), asc(boardQuickFilters.name)),
	]);

	const statusRows =
		columnRows.length === 0
			? []
			: await db
					.select({
						columnId: boardColumnStatuses.columnId,
						statusId: statuses.id,
						name: statuses.name,
						category: statuses.category,
						sequence: boardColumnStatuses.sequence,
					})
					.from(boardColumnStatuses)
					.innerJoin(statuses, eq(statuses.id, boardColumnStatuses.statusId))
					.where(
						inArray(
							boardColumnStatuses.columnId,
							columnRows.map((column) => column.id),
						),
					)
					.orderBy(asc(boardColumnStatuses.sequence), asc(statuses.name));

	const statusesByColumn = new Map<string, StatusRow[]>();
	for (const row of statusRows) {
		const list = statusesByColumn.get(row.columnId) ?? [];
		list.push({ id: row.statusId, name: row.name, category: row.category });
		statusesByColumn.set(row.columnId, list);
	}

	const kanbanBacklogStatus = board.kanbanBacklogStatusId
		? ((
				await db
					.select({
						id: statuses.id,
						name: statuses.name,
						category: statuses.category,
					})
					.from(statuses)
					.where(eq(statuses.id, board.kanbanBacklogStatusId))
					.limit(1)
			)[0] ?? null)
		: null;

	return {
		board,
		columns: columnRows.map((column) => ({
			id: column.id,
			name: column.name,
			sequence: column.sequence,
			minIssues: column.minIssues,
			maxIssues: column.maxIssues,
			statuses: statusesByColumn.get(column.id) ?? [],
		})),
		swimlanes: swimlaneRows.map((row) => ({
			id: row.id,
			name: row.name,
			jql: row.jql,
			sequence: row.sequence,
		})),
		quickFilters: quickFilterRows.map((row) => ({
			id: row.id,
			name: row.name,
			jql: row.jql,
			sequence: row.sequence,
		})),
		kanbanBacklogStatus,
		availableStatuses: mergeAvailableStatuses(
			await statusesForProject(board.projectId),
			statusRows,
		),
	};
}

function mergeAvailableStatuses(
	available: StatusRow[],
	mapped: { statusId: string; name: string; category: StatusRow["category"] }[],
) {
	const result = [...available];
	const seen = new Set(available.map((status) => status.id));
	for (const status of mapped) {
		if (seen.has(status.statusId)) continue;
		seen.add(status.statusId);
		result.push({
			id: status.statusId,
			name: status.name,
			category: status.category,
		});
	}
	return result.sort((left, right) => left.name.localeCompare(right.name));
}

function boardConfig(
	row: BoardRow,
	config: NonNullable<Awaited<ReturnType<typeof loadBoardConfig>>>,
) {
	return {
		...boardRef(row),
		filterJql: row.filterJql,
		estimationField: row.estimationField,
		swimlaneStrategy: row.swimlaneStrategy,
		cardColourStrategy: row.cardColourStrategy,
		subFilterJql: row.subFilterJql,
		kanbanBacklogStatus: config.kanbanBacklogStatus,
		columns: config.columns,
		swimlanes: config.swimlanes,
		quickFilters: config.quickFilters,
		availableStatuses: config.availableStatuses,
	};
}

class StaleStatusError extends Error {}

function jqlFailure(error: unknown): never {
	if (error instanceof JqlError) throw new HttpError(400, error.jiraMessage);
	throw error;
}

async function validateJql(jql: string, user: SearchUser) {
	return compileJql(parseJql(jql), {
		user,
		visibleProjectIds: await viewerProjectIds(user),
	});
}

async function conditionsFor(
	jqls: (string | null | undefined)[],
	user: SearchUser,
	catalog: Awaited<ReturnType<typeof loadCatalog>>,
): Promise<SQL[]> {
	const conditions: SQL[] = [];
	const visible = await viewerProjectIds(user);
	for (const jql of jqls) {
		if (!jql?.trim()) continue;
		const compiled = await compileJql(parseJql(jql), {
			user,
			catalog,
			visibleProjectIds: visible,
		});
		if (compiled.where) conditions.push(compiled.where);
	}
	if (conditions.length === 0) {
		conditions.push(
			sql`issues.project_id = any(${sql.param(visible)}::uuid[])`,
		);
	}
	return conditions;
}

function likePattern(value: string) {
	return `%${value.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

async function boardFilterConditions(
	board: BoardRow,
	user: SearchUser,
	query: z.infer<typeof searchQuery>,
	config: NonNullable<Awaited<ReturnType<typeof loadBoardConfig>>>,
): Promise<SQL[]> {
	const catalog = await loadCatalog();
	const conditions = await conditionsFor(
		[board.filterJql, board.subFilterJql],
		user,
		catalog,
	);

	const selected = (query.quickFilter ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	for (const id of selected) {
		const filter = config.quickFilters.find((item) => item.id === id);
		if (filter) {
			const compiled = await compileJql(parseJql(filter.jql), {
				user,
				catalog,
				visibleProjectIds: await viewerProjectIds(user),
			});
			if (compiled.where) conditions.push(compiled.where);
		}
	}

	if (query.text?.trim()) {
		const pattern = likePattern(query.text.trim());
		conditions.push(
			sql`(issues.summary ilike ${pattern} escape '!' or issues.key ilike ${pattern} escape '!')`,
		);
	}
	if (query.epic) {
		conditions.push(
			sql`issues.epic_id = (select id from issues where upper(key) = ${query.epic.toUpperCase()})`,
		);
	}
	if (query.version) {
		conditions.push(
			sql`exists (select 1 from issue_fix_versions fv where fv.issue_id = issues.id and fv.version_id = ${query.version})`,
		);
	}
	if (query.assignee) {
		conditions.push(
			sql`exists (select 1 from users u where u.id = issues.assignee_id and u.username = ${query.assignee})`,
		);
	}
	return conditions;
}

type BoardIssueRow = {
	id: string;
	key: string;
	summary: string;
	rank: string | null;
	typeId: string;
	typeName: string;
	typeSubtask: boolean;
	typeIconUrl: string | null;
	statusId: string;
	statusName: string;
	statusCategory: "new" | "indeterminate" | "done";
	priorityId: string | null;
	priorityName: string | null;
	priorityColor: string | null;
	priorityIconUrl: string | null;
	assigneeId: string | null;
	assigneeUsername: string | null;
	assigneeDisplayName: string | null;
	assigneeAvatarUrl: string | null;
	epicId: string | null;
	epicKey: string | null;
	epicSummary: string | null;
	epicColour: string | null;
	estimate: number | null;
	flagged: boolean;
	sprintId: string | null;
};

async function epicColourSource(): Promise<string | null> {
	const rows = await db
		.select({
			sourceId: fields.sourceId,
			name: fields.name,
			type: fields.type,
			customKey: fields.customKey,
		})
		.from(fields);
	return customFieldId(resolveCustomFieldRoles(rows), "epicColour");
}

async function flaggedFieldSource() {
	const result = await db.execute(
		sql`select source_id from fields where lower(name) = 'flagged' limit 1`,
	);
	return (result.rows as { source_id: string }[])[0]?.source_id ?? null;
}

async function loadBoardIssueRows(options: {
	conditions: SQL[];
	mode: "sprint" | "kanban" | "backlog";
	sprintId: string | null;
	estimationField: "story_points" | "original_estimate" | "issue_count";
	user: SearchUser;
	extraConditions?: SQL[];
	excludeIssueIds?: string[];
	executor?: Parameters<Parameters<typeof db.transaction>[0]>[0];
}): Promise<BoardIssueRow[]> {
	const conditions = [
		...options.conditions,
		...(options.extraConditions ?? []),
	];
	const membership =
		options.mode === "sprint"
			? sql`join issue_sprints isp on isp.issue_id = issues.id and isp.is_open and isp.sprint_id = ${options.sprintId}`
			: sql`left join issue_sprints isp on isp.issue_id = issues.id and isp.is_open`;
	if (options.mode === "backlog") {
		conditions.push(sql`isp.issue_id is null`);
		// A done issue stays in its closed sprint; it does not return to the
		// backlog. Unfinished issues that were moved out of a closed sprint do.
		conditions.push(sql`not (
			s.category = 'done' and exists (
				select 1 from issue_sprints closed_membership
				join sprints closed_sprint on closed_sprint.id = closed_membership.sprint_id
				where closed_membership.issue_id = issues.id
					and closed_membership.is_open = false
					and closed_sprint.state = 'closed'
			)
		)`);
	}
	if (options.excludeIssueIds && options.excludeIssueIds.length > 0) {
		conditions.push(
			sql`issues.id not in (${sql.join(
				options.excludeIssueIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
	}
	if (conditions.length === 0) conditions.push(sql`true`);

	const estimate =
		options.estimationField === "story_points"
			? sql`issues.story_points`
			: options.estimationField === "original_estimate"
				? sql`issues.original_estimate`
				: sql`1`;
	const colourSource = await epicColourSource();
	const epicColour = colourSource ? sql`e.custom->>${colourSource}` : sql`null`;
	const flaggedSource = await flaggedFieldSource();
	const visibleProjectIds = await viewerProjectIds(options.user);
	const flagged = flaggedSource
		? sql`coalesce((issues.custom->${flaggedSource}) <> '[]'::jsonb, false)`
		: sql`false`;

	const query = sql`
		select
			issues.id,
			issues.key,
			issues.summary,
			issues.rank,
			t.id as type_id,
			t.name as type_name,
			t.subtask as type_subtask,
			case when t.icon_file is null or t.icon_url like 'builtin:%' then t.icon_url else '/api/avatars/issuetypes/' || t.id::text end as type_icon_url,
			s.id as status_id,
			s.name as status_name,
			s.category as status_category,
			pr.id as priority_id,
			pr.name as priority_name,
			pr.icon_color as priority_color,
			case when pr.icon_file is null then null else '/api/avatars/priorities/' || pr.id::text end as priority_icon_url,
			a.id as assignee_id,
			a.username as assignee_username,
			a.display_name as assignee_display_name,
			case when a.id is null then null else '/api/avatars/users/' || a.id::text end as assignee_avatar_url,
			e.id as epic_id,
			e.key as epic_key,
			e.summary as epic_summary,
			${epicColour} as epic_colour,
			${estimate} as estimate,
			${flagged} as flagged,
			isp.sprint_id
		from issues
		join issue_types t on t.id = issues.type_id
		join statuses s on s.id = issues.status_id
		left join priorities pr on pr.id = issues.priority_id
		left join users a on a.id = issues.assignee_id
		left join issues e on e.id = issues.epic_id
			and e.project_id = any(${sql.param(visibleProjectIds)}::uuid[])
		${membership}
		where ${sql.join(conditions, sql` and `)}
		order by issues.rank collate "C", issues.key
	`;
	const result = options.executor
		? await options.executor.execute(query)
		: await withStatementTimeout((tx) => tx.execute(query));

	return (result.rows as Record<string, unknown>[]).map((row) => ({
		id: String(row.id),
		key: String(row.key),
		summary: String(row.summary),
		rank: row.rank === null ? null : String(row.rank),
		typeId: String(row.type_id),
		typeName: String(row.type_name),
		typeSubtask: Boolean(row.type_subtask),
		typeIconUrl: row.type_icon_url === null ? null : String(row.type_icon_url),
		statusId: String(row.status_id),
		statusName: String(row.status_name),
		statusCategory: row.status_category as BoardIssueRow["statusCategory"],
		priorityId: row.priority_id === null ? null : String(row.priority_id),
		priorityName: row.priority_name === null ? null : String(row.priority_name),
		priorityColor:
			row.priority_color === null ? null : String(row.priority_color),
		priorityIconUrl:
			row.priority_icon_url === null ? null : String(row.priority_icon_url),
		assigneeId: row.assignee_id === null ? null : String(row.assignee_id),
		assigneeUsername:
			row.assignee_username === null ? null : String(row.assignee_username),
		assigneeDisplayName:
			row.assignee_display_name === null
				? null
				: String(row.assignee_display_name),
		assigneeAvatarUrl:
			row.assignee_avatar_url === null ? null : String(row.assignee_avatar_url),
		epicId: row.epic_id === null ? null : String(row.epic_id),
		epicKey: row.epic_key === null ? null : String(row.epic_key),
		epicSummary: row.epic_summary === null ? null : String(row.epic_summary),
		epicColour: row.epic_colour === null ? null : String(row.epic_colour),
		estimate: row.estimate === null ? null : Number(row.estimate),
		flagged: Boolean(row.flagged),
		sprintId: row.sprint_id === null ? null : String(row.sprint_id),
	}));
}

function boardIssue(row: BoardIssueRow, columnId: string | null) {
	return {
		id: row.id,
		key: row.key,
		summary: row.summary,
		type: {
			id: row.typeId,
			name: row.typeName,
			subtask: row.typeSubtask,
			iconUrl: row.typeIconUrl,
		},
		status: {
			id: row.statusId,
			name: row.statusName,
			category: row.statusCategory,
		},
		priority: row.priorityId
			? {
					id: row.priorityId,
					name: row.priorityName as string,
					iconColor: row.priorityColor,
					iconUrl: row.priorityIconUrl,
				}
			: null,
		assignee: userRef({
			id: row.assigneeId,
			username: row.assigneeUsername,
			displayName: row.assigneeDisplayName,
			avatarUrl: row.assigneeAvatarUrl,
		}),
		epic:
			row.epicId && row.epicKey && row.epicSummary
				? {
						key: row.epicKey,
						summary: row.epicSummary,
						colour: row.epicColour,
					}
				: null,
		estimate: row.estimate,
		flagged: row.flagged,
		rank: row.rank,
		sprintId: row.sprintId,
		columnId,
	};
}

function emptyTotals() {
	return { new: 0, indeterminate: 0, done: 0 };
}

function addTotals(
	totals: ReturnType<typeof emptyTotals>,
	issue: {
		status: { category: "new" | "indeterminate" | "done" };
		estimate: number | null;
	},
) {
	totals[issue.status.category] += issue.estimate ?? 0;
}

function sprintPayload(row: typeof sprints.$inferSelect) {
	return {
		id: row.id,
		name: row.name,
		goal: row.goal,
		state: row.state,
		startDate: iso(row.startDate),
		endDate: iso(row.endDate),
		completeDate: iso(row.completeDate),
		sequence: row.sequence,
	};
}

async function loadActiveSprint(boardId: string) {
	const [row] = await db
		.select()
		.from(sprints)
		.where(
			and(
				or(
					eq(sprints.boardId, boardId),
					sql`exists (select 1 from ${boardSprints} bs where bs.sprint_id = ${sprints.id} and bs.board_id = ${boardId})`,
				),
				eq(sprints.state, "active"),
			),
		)
		.orderBy(asc(sprints.sequence))
		.limit(1);
	return row ?? null;
}

function columnForStatus(
	config: NonNullable<Awaited<ReturnType<typeof loadBoardConfig>>>,
	statusId: string,
) {
	return (
		config.columns.find((column) =>
			column.statuses.some((status) => status.id === statusId),
		)?.id ?? null
	);
}

async function buildSwimlanes(options: {
	board: BoardRow;
	config: NonNullable<Awaited<ReturnType<typeof loadBoardConfig>>>;
	rows: BoardIssueRow[];
	conditions: SQL[];
	user: SearchUser;
}) {
	const { board, config, rows, conditions, user } = options;
	const issuesWithColumns = rows.map((row) =>
		boardIssue(row, columnForStatus(config, row.statusId)),
	);
	const visible = issuesWithColumns.filter((issue) => issue.columnId !== null);

	if (board.swimlaneStrategy === "none") {
		return [{ id: "all", name: null, issues: visible }];
	}

	if (board.swimlaneStrategy === "assignee") {
		const lanes = new Map<string, { name: string; issues: typeof visible }>();
		for (const issue of visible) {
			const key = issue.assignee?.username ?? "";
			const lane = lanes.get(key) ?? {
				name: issue.assignee?.displayName ?? "Unassigned",
				issues: [],
			};
			lane.issues.push(issue);
			lanes.set(key, lane);
		}
		return [...lanes.entries()]
			.sort(([left], [right]) => {
				if (left === "") return 1;
				if (right === "") return -1;
				return left.localeCompare(right);
			})
			.map(([key, lane]) => ({
				id: `assignee:${key}`,
				name: lane.name,
				issues: lane.issues,
			}));
	}

	if (board.swimlaneStrategy === "epic") {
		const lanes = new Map<string, { name: string; issues: typeof visible }>();
		for (const issue of visible) {
			const key = issue.epic?.key ?? "";
			const lane = lanes.get(key) ?? {
				name: issue.epic
					? `${issue.epic.key} ${issue.epic.summary}`
					: "Issues without epic",
				issues: [],
			};
			lane.issues.push(issue);
			lanes.set(key, lane);
		}
		return [...lanes.entries()]
			.sort(([left], [right]) => {
				if (left === "") return 1;
				if (right === "") return -1;
				return left.localeCompare(right);
			})
			.map(([key, lane]) => ({
				id: `epic:${key}`,
				name: lane.name,
				issues: lane.issues,
			}));
	}

	const catalog = await loadCatalog();
	const assigned = new Set<string>();
	const lanes: { id: string; name: string | null; issues: typeof visible }[] =
		[];
	for (const swimlane of config.swimlanes) {
		const compiled = await compileJql(parseJql(swimlane.jql), {
			user,
			catalog,
			visibleProjectIds: await viewerProjectIds(user),
		});
		const laneConditions = [...conditions];
		if (compiled.where) laneConditions.push(compiled.where);
		const result = await withStatementTimeout((tx) =>
			tx.execute(sql`
			select issues.id from issues
			where ${sql.join(laneConditions, sql` and `)}
		`),
		);
		const ids = new Set(
			(result.rows as { id: string }[]).map((row) => String(row.id)),
		);
		const laneIssues = visible.filter(
			(issue) => ids.has(issue.id) && !assigned.has(issue.id),
		);
		for (const issue of laneIssues) assigned.add(issue.id);
		lanes.push({ id: swimlane.id, name: swimlane.name, issues: laneIssues });
	}
	const rest = visible.filter((issue) => !assigned.has(issue.id));
	if (rest.length > 0) {
		lanes.push({
			id: "everything-else",
			name: "Everything else",
			issues: rest,
		});
	}
	return lanes;
}

async function boardData(
	board: BoardRow,
	config: NonNullable<Awaited<ReturnType<typeof loadBoardConfig>>>,
	user: SearchUser,
	query: z.infer<typeof searchQuery>,
) {
	const conditions = await boardFilterConditions(board, user, query, config);
	const activeSprint =
		board.type === "scrum" ? await loadActiveSprint(board.id) : null;
	if (board.type === "scrum" && !activeSprint) {
		return {
			board: boardConfig(board, config),
			activeSprint: null,
			columns: config.columns,
			swimlanes: [],
			quickFilters: config.quickFilters,
			total: 0,
		};
	}

	const extra: SQL[] = [];
	if (board.type === "kanban" && board.kanbanBacklogStatusId) {
		// A Jira kanban board can show its backlog as a real "Backlog" column.
		// A board configured locally uses the backlog status as a separate view.
		const backlogColumn = config.columns.find(
			(column) => column.name.toLowerCase() === "backlog",
		);
		const backlogIsOnBoard = backlogColumn?.statuses.some(
			(status) => status.id === board.kanbanBacklogStatusId,
		);
		if (!backlogIsOnBoard) {
			extra.push(sql`issues.status_id <> ${board.kanbanBacklogStatusId}`);
		}
	}
	const rows = await loadBoardIssueRows({
		conditions,
		mode: board.type === "scrum" ? "sprint" : "kanban",
		sprintId: activeSprint?.id ?? null,
		estimationField: board.estimationField,
		user,
		extraConditions: extra,
	});
	const swimlanes = await buildSwimlanes({
		board,
		config,
		rows,
		conditions,
		user,
	});

	return {
		board: boardConfig(board, config),
		activeSprint: activeSprint ? sprintPayload(activeSprint) : null,
		columns: config.columns,
		swimlanes,
		quickFilters: config.quickFilters,
		total: swimlanes.reduce((sum, lane) => sum + lane.issues.length, 0),
	};
}

async function epicPanel(listConditions: SQL[], countConditions: SQL[]) {
	const colourSource = await epicColourSource();
	const colour = colourSource ? sql`e.custom->>${colourSource}` : sql`null`;
	const projectResult = await withStatementTimeout((tx) =>
		tx.execute(sql`
		select distinct issues.project_id from issues
		where ${sql.join(listConditions, sql` and `)}
	`),
	);
	const projectIds = (projectResult.rows as { project_id: string }[]).map(
		(row) => String(row.project_id),
	);
	if (projectIds.length === 0) return [];

	const epicRows = await db.execute(sql`
		select e.id, e.key, e.summary, ${colour} as colour
		from issues e
		join issue_types t on t.id = e.type_id
		where t.name = 'Epic'
			and e.project_id in (${sql.join(
				projectIds.map((id) => sql`${id}`),
				sql`, `,
			)})
		order by e.rank collate "C", e.key
	`);
	const countResult = await withStatementTimeout((tx) =>
		tx.execute(sql`
		select issues.epic_id, count(*)::int as total,
			count(*) filter (where s.category = 'done')::int as done
		from issues
		join statuses s on s.id = issues.status_id
		where issues.epic_id is not null
			and ${sql.join(countConditions, sql` and `)}
		group by issues.epic_id
	`),
	);
	const counts = new Map(
		(
			countResult.rows as { epic_id: string; total: number; done: number }[]
		).map((row) => [String(row.epic_id), row]),
	);
	return (
		epicRows.rows as {
			id: string;
			key: string;
			summary: string;
			colour: string | null;
		}[]
	).map((row) => ({
		key: row.key,
		summary: row.summary,
		colour: row.colour,
		issueCount: counts.get(String(row.id))?.total ?? 0,
		doneCount: counts.get(String(row.id))?.done ?? 0,
	}));
}

async function versionPanel(listConditions: SQL[], countConditions: SQL[]) {
	const projectResult = await withStatementTimeout((tx) =>
		tx.execute(sql`
		select distinct issues.project_id from issues
		where ${sql.join(listConditions, sql` and `)}
	`),
	);
	const projectIds = (projectResult.rows as { project_id: string }[]).map(
		(row) => String(row.project_id),
	);
	if (projectIds.length === 0) return [];
	const versionRows = await db
		.select()
		.from(versions)
		.where(inArray(versions.projectId, projectIds))
		.orderBy(asc(versions.sequence), asc(versions.name));
	const countResult = await withStatementTimeout((tx) =>
		tx.execute(sql`
		select fv.version_id, count(*)::int as total
		from issue_fix_versions fv
		join issues on issues.id = fv.issue_id
		where ${sql.join(countConditions, sql` and `)}
		group by fv.version_id
	`),
	);
	const counts = new Map(
		(countResult.rows as { version_id: string; total: number }[]).map((row) => [
			String(row.version_id),
			row.total,
		]),
	);
	return versionRows.map((row) => ({
		id: row.id,
		name: row.name,
		released: row.released,
		issueCount: counts.get(row.id) ?? 0,
	}));
}

async function backlogData(
	board: BoardRow,
	config: NonNullable<Awaited<ReturnType<typeof loadBoardConfig>>>,
	user: SearchUser,
	query: z.infer<typeof searchQuery>,
) {
	const conditions = await boardFilterConditions(board, user, query, config);
	const facetConditions = await boardFilterConditions(board, user, {}, config);
	const sprintRows = await db
		.select()
		.from(sprints)
		.where(
			and(
				or(
					eq(sprints.boardId, board.id),
					sql`exists (select 1 from ${boardSprints} bs where bs.sprint_id = ${sprints.id} and bs.board_id = ${board.id})`,
				),
				inArray(sprints.state, ["active", "future"]),
			),
		)
		.orderBy(asc(sprints.sequence), asc(sprints.name));

	const [sprintPayloads, epics, versions] = await Promise.all([
		Promise.all(
			sprintRows.map(async (sprint) => {
				const rows = await loadBoardIssueRows({
					conditions,
					mode: "sprint",
					sprintId: sprint.id,
					estimationField: board.estimationField,
					user,
				});
				const issues = rows.map((row) => boardIssue(row, null));
				const totals = emptyTotals();
				for (const issue of issues) addTotals(totals, issue);
				return {
					...sprintPayload(sprint),
					issues,
					totals,
				};
			}),
		),
		epicPanel(facetConditions, conditions),
		versionPanel(facetConditions, conditions),
	]);

	let backlogRows: BoardIssueRow[] = [];
	if (board.type === "scrum" || board.kanbanBacklogStatusId) {
		const extra: SQL[] = [];
		if (board.type === "kanban" && board.kanbanBacklogStatusId) {
			extra.push(sql`issues.status_id = ${board.kanbanBacklogStatusId}`);
		}
		backlogRows = await loadBoardIssueRows({
			conditions,
			mode: board.type === "scrum" ? "backlog" : "kanban",
			sprintId: null,
			estimationField: board.estimationField,
			user,
			extraConditions: extra,
		});
	}
	const backlogIssues = backlogRows.map((row) => boardIssue(row, null));
	const backlogTotals = emptyTotals();
	for (const issue of backlogIssues) addTotals(backlogTotals, issue);

	return {
		board: boardConfig(board, config),
		sprints: sprintPayloads,
		backlog: { issues: backlogIssues, totals: backlogTotals },
		epics,
		versions,
		quickFilters: config.quickFilters,
		availableStatuses: config.availableStatuses,
	};
}

export async function canManageBoard(
	board: Pick<BoardRow, "ownerId" | "projectId">,
	user: CurrentUser,
	permission: PermissionKey,
) {
	if (user.isAdmin || board.ownerId === user.id) return true;
	if (!board.projectId) return false;
	const project = await projectForId(board.projectId);
	return Boolean(project) && (await can(user, permission, project));
}

export async function canAccessProjectlessBoard(
	board: Pick<BoardRow, "ownerId" | "filterJql" | "subFilterJql">,
	user: CurrentUser,
) {
	if (user.isAdmin || board.ownerId === user.id) return true;
	const catalog = await loadCatalog();
	const visible = await viewerProjectIds(user);
	const conditions: SQL[] = [];
	try {
		for (const jql of [board.filterJql, board.subFilterJql]) {
			if (!jql?.trim()) continue;
			const compiled = await compileJql(parseJql(jql), {
				user,
				catalog,
				visibleProjectIds: visible,
			});
			if (compiled.where) conditions.push(compiled.where);
		}
	} catch (error) {
		if (error instanceof JqlError) return false;
		throw error;
	}
	if (conditions.length === 0) return false;
	const result = await withStatementTimeout((tx) =>
		tx.execute(sql`
			select 1 from issues
			where ${sql.join(conditions, sql` and `)}
			limit 1
		`),
	);
	return result.rows.length > 0;
}

async function requireBoard(user: CurrentUser, rapidViewId: number) {
	const board = await loadBoardRow(rapidViewId);
	if (!board) throw new HttpError(404, "Board not found");
	if (board.projectId) {
		await requireBrowseProject(user, board.projectId);
	} else if (!(await canAccessProjectlessBoard(board, user))) {
		throw new HttpError(404, "Board not found");
	}
	return board;
}

async function requireWritableBoard(board: BoardRow) {
	if (!board.projectId) return;
	const [project] = await db
		.select({ archived: projects.archived })
		.from(projects)
		.where(eq(projects.id, board.projectId))
		.limit(1);
	if (project?.archived) {
		throw new HttpError(403, "This project is archived and read-only");
	}
}

async function requireSprintBoard(user: CurrentUser, boardId: string) {
	const [row] = await db
		.select({ rapidViewId: boards.rapidViewId })
		.from(boards)
		.where(eq(boards.id, boardId))
		.limit(1);
	return requireBoard(user, row?.rapidViewId ?? 0);
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function deriveColumns(
	tx: Transaction,
	boardId: string,
	projectId: string,
) {
	const list = await statusesForProject(projectId, tx);

	const groups: { name: string; category: StatusRow["category"] }[] = [
		{ name: "To Do", category: "new" },
		{ name: "In Progress", category: "indeterminate" },
		{ name: "Done", category: "done" },
	];
	let sequence = 0;
	for (const group of groups) {
		const [column] = await tx
			.insert(boardColumns)
			.values({ boardId, name: group.name, sequence })
			.returning({ id: boardColumns.id });
		sequence += 1;
		const matching = list.filter(
			(status) => status.category === group.category,
		);
		if (matching.length > 0) {
			await tx.insert(boardColumnStatuses).values(
				matching.map((status, index) => ({
					columnId: column.id,
					statusId: status.id,
					sequence: index,
				})),
			);
		}
	}
}

/** Serialize writes that change the board's sprint list or issue ranks. */
async function lockBoard(tx: Transaction, boardId: string) {
	await tx.execute(sql`select id from boards where id = ${boardId} for update`);
}

async function nextRapidViewId(tx: Transaction) {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtext('rvna.boards.rapid_view_id'))`,
	);
	const result = await tx.execute(
		sql`select coalesce(max(rapid_view_id), 0) + 1 as next from boards`,
	);
	return Number((result.rows[0] as { next: number }).next);
}

async function replaceColumns(
	boardId: string,
	columns: z.infer<typeof columnsBody>["columns"],
) {
	const allStatusIds = columns.flatMap((column) => column.statuses);
	const unique = new Set(allStatusIds);
	if (unique.size !== allStatusIds.length) {
		throw new HttpError(400, "A status can only be mapped to one column");
	}
	const existing = await loadStatuses(allStatusIds);
	if (existing.length !== unique.size) {
		throw new HttpError(400, "Unknown status");
	}
	await db.transaction(async (tx) => {
		await tx.delete(boardColumns).where(eq(boardColumns.boardId, boardId));
		for (const [sequence, column] of columns.entries()) {
			const [created] = await tx
				.insert(boardColumns)
				.values({
					boardId,
					name: column.name,
					sequence,
					minIssues: column.minIssues ?? null,
					maxIssues: column.maxIssues ?? null,
				})
				.returning({ id: boardColumns.id });
			if (column.statuses.length > 0) {
				await tx.insert(boardColumnStatuses).values(
					column.statuses.map((statusId, index) => ({
						columnId: created.id,
						statusId,
						sequence: index,
					})),
				);
			}
		}
	});
}

async function replaceSwimlanes(
	boardId: string,
	swimlanes: z.infer<typeof swimlanesBody>["swimlanes"],
	user: SearchUser,
) {
	for (const swimlane of swimlanes) {
		await validateJql(swimlane.jql, user);
	}
	await db.transaction(async (tx) => {
		await tx.delete(boardSwimlanes).where(eq(boardSwimlanes.boardId, boardId));
		if (swimlanes.length > 0) {
			await tx.insert(boardSwimlanes).values(
				swimlanes.map((swimlane, sequence) => ({
					boardId,
					name: swimlane.name,
					jql: swimlane.jql,
					sequence,
				})),
			);
		}
	});
}

async function replaceQuickFilters(
	boardId: string,
	quickFilters: z.infer<typeof quickFiltersBody>["quickFilters"],
	user: SearchUser,
) {
	for (const filter of quickFilters) {
		await validateJql(filter.jql, user);
	}
	await db.transaction(async (tx) => {
		await tx
			.delete(boardQuickFilters)
			.where(eq(boardQuickFilters.boardId, boardId));
		if (quickFilters.length > 0) {
			await tx.insert(boardQuickFilters).values(
				quickFilters.map((filter, sequence) => ({
					boardId,
					name: filter.name,
					jql: filter.jql,
					sequence,
				})),
			);
		}
	});
}

async function targetContainerPlan(
	board: BoardRow,
	config: NonNullable<Awaited<ReturnType<typeof loadBoardConfig>>>,
	user: SearchUser,
	body: z.infer<typeof moveBody>,
) {
	const conditions = await conditionsFor(
		[board.filterJql],
		user,
		await loadCatalog(),
	);
	const extra: SQL[] = [];
	if (body.columnId) {
		const column = config.columns.find((item) => item.id === body.columnId);
		if (!column) throw new HttpError(400, "Unknown column");
		if (column.statuses.length === 0)
			throw new HttpError(400, "The column has no statuses");
		const statusIds = column.statuses.map((status) => status.id);
		extra.push(
			sql`issues.status_id in (${sql.join(
				statusIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
	}
	let mode: "sprint" | "kanban" | "backlog";
	let sprintId: string | null = null;
	let writesSprint = body.sprintId !== undefined;
	if (body.sprintId !== undefined && body.sprintId !== null) {
		const [sprint] = await db
			.select()
			.from(sprints)
			.where(eq(sprints.id, body.sprintId))
			.limit(1);
		if (!sprint || sprint.boardId !== board.id) {
			throw new HttpError(400, "Unknown sprint");
		}
		if (sprint.state === "closed")
			throw new HttpError(400, "The sprint is closed");
		mode = "sprint";
		sprintId = sprint.id;
	} else if (body.sprintId === null) {
		mode = board.type === "kanban" ? "kanban" : "backlog";
	} else if (body.columnId) {
		const active =
			board.type === "scrum" ? await loadActiveSprint(board.id) : null;
		if (board.type === "scrum" && !active) {
			throw new HttpError(400, "The board has no active sprint");
		}
		mode = board.type === "scrum" ? "sprint" : "kanban";
		sprintId = active?.id ?? null;
		writesSprint = board.type === "scrum";
	} else {
		mode = board.type === "kanban" ? "kanban" : "backlog";
	}
	return { conditions, mode, sprintId, extra, writesSprint };
}

export async function listBoards(
	actor: CurrentUser,
	options: { projectId?: string } = {},
) {
	const administered = new Set(
		await projectIdsWith(actor, "ADMINISTER_PROJECTS"),
	);
	const scope = options.projectId
		? eq(boards.projectId, options.projectId)
		: or(
				isNull(boards.projectId),
				inArray(boards.projectId, await viewerProjectIds(actor)),
			);
	const rows = await db
		.select({
			id: boards.id,
			rapidViewId: boards.rapidViewId,
			sourceId: boards.sourceId,
			name: boards.name,
			type: boards.type,
			filterJql: boards.filterJql,
			projectId: projects.id,
			projectKey: projects.key,
			projectName: projects.name,
			estimationField: boards.estimationField,
			swimlaneStrategy: boards.swimlaneStrategy,
			cardColourStrategy: boards.cardColourStrategy,
			subFilterJql: boards.subFilterJql,
			kanbanBacklogStatusId: boards.kanbanBacklogStatusId,
			ownerId: users.id,
			ownerUsername: users.username,
			ownerDisplayName: users.displayName,
			ownerAvatarUrl: userAvatarSql(users.id),
			configImported: boards.configImported,
		})
		.from(boards)
		.leftJoin(projects, eq(projects.id, boards.projectId))
		.leftJoin(users, eq(users.id, boards.ownerId))
		.where(scope)
		.orderBy(asc(boards.name));
	const access = await Promise.all(
		rows.map((row) =>
			row.projectId === null ? canAccessProjectlessBoard(row, actor) : true,
		),
	);
	const visibleRows = rows.filter((_, index) => access[index]);
	return visibleRows.map((row) => ({
		...boardRef(row),
		canAdminister:
			actor.isAdmin ||
			row.ownerId === actor.id ||
			(row.projectId !== null && administered.has(row.projectId)),
	}));
}

export async function createBoard(
	actor: CurrentUser,
	body: z.infer<typeof boardCreateBody>,
) {
	try {
		await validateJql(body.filterJql, actor);
	} catch (error) {
		jqlFailure(error);
	}
	const [project] = await db
		.select()
		.from(projects)
		.where(eq(projects.key, body.project.toUpperCase()))
		.limit(1);
	if (!project) throw new HttpError(404, "Project not found");
	await requireBrowseProject(actor, project.id);

	const created = await db.transaction(async (tx) => {
		const rapidViewId = await nextRapidViewId(tx);
		const [row] = await tx
			.insert(boards)
			.values({
				rapidViewId,
				name: body.name,
				type: body.type,
				filterJql: body.filterJql,
				projectId: project.id,
				estimationField: body.estimationField ?? "story_points",
				ownerId: actor.id,
			})
			.returning({ id: boards.id, rapidViewId: boards.rapidViewId });
		if (!row) throw new HttpError(404, "Board not found");
		await deriveColumns(tx, row.id, project.id);
		return row;
	});
	const config = await loadBoardConfig(created.rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	return boardConfig(config.board, config);
}

export async function getBoard(actor: CurrentUser, rapidViewId: number) {
	await requireBoard(actor, rapidViewId);
	const config = await loadBoardConfig(rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	return boardConfig(config.board, config);
}

export async function updateBoard(
	actor: CurrentUser,
	rapidViewId: number,
	body: z.infer<typeof boardPatchBody>,
) {
	const board = await requireBoard(actor, rapidViewId);
	if (!(await canManageBoard(board, actor, "ADMINISTER_PROJECTS"))) {
		throw new HttpError(403, "Only board administrators can change this board");
	}
	let projectId: string | undefined;
	if (body.project) {
		const [project] = await db
			.select()
			.from(projects)
			.where(eq(projects.key, body.project.toUpperCase()))
			.limit(1);
		if (!project) throw new HttpError(404, "Project not found");
		await requireBrowseProject(actor, project.id);
		projectId = project.id;
	}
	if (body.filterJql) {
		try {
			await validateJql(body.filterJql, actor);
		} catch (error) {
			jqlFailure(error);
		}
	}
	if (body.subFilterJql) {
		try {
			await validateJql(body.subFilterJql, actor);
		} catch (error) {
			jqlFailure(error);
		}
	}
	if (body.kanbanBacklogStatusId) {
		const [status] = await db
			.select({ id: statuses.id })
			.from(statuses)
			.where(eq(statuses.id, body.kanbanBacklogStatusId))
			.limit(1);
		if (!status) throw new HttpError(400, "Unknown status");
	}
	await db
		.update(boards)
		.set({
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.filterJql !== undefined ? { filterJql: body.filterJql } : {}),
			...(projectId !== undefined ? { projectId } : {}),
			...(body.estimationField !== undefined
				? { estimationField: body.estimationField }
				: {}),
			...(body.swimlaneStrategy !== undefined
				? { swimlaneStrategy: body.swimlaneStrategy }
				: {}),
			...(body.cardColourStrategy !== undefined
				? { cardColourStrategy: body.cardColourStrategy }
				: {}),
			...(body.subFilterJql !== undefined
				? { subFilterJql: body.subFilterJql }
				: {}),
			...(body.kanbanBacklogStatusId !== undefined
				? { kanbanBacklogStatusId: body.kanbanBacklogStatusId }
				: {}),
			configImported: true,
			updatedAt: new Date(),
		})
		.where(eq(boards.id, board.id));
	const config = await loadBoardConfig(board.rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	return boardConfig(config.board, config);
}

export async function deleteBoard(actor: CurrentUser, rapidViewId: number) {
	const board = await requireBoard(actor, rapidViewId);
	if (!(await canManageBoard(board, actor, "ADMINISTER_PROJECTS"))) {
		throw new HttpError(403, "Only board administrators can delete this board");
	}
	await db.delete(boards).where(eq(boards.id, board.id));
}

export async function replaceBoardColumns(
	actor: CurrentUser,
	rapidViewId: number,
	body: z.infer<typeof columnsBody>,
) {
	const board = await requireBoard(actor, rapidViewId);
	if (!(await canManageBoard(board, actor, "ADMINISTER_PROJECTS"))) {
		throw new HttpError(403, "Only board administrators can change this board");
	}
	await replaceColumns(board.id, body.columns);
	const config = await loadBoardConfig(board.rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	return boardConfig(config.board, config);
}

export async function replaceBoardSwimlanes(
	actor: CurrentUser,
	rapidViewId: number,
	body: z.infer<typeof swimlanesBody>,
) {
	const board = await requireBoard(actor, rapidViewId);
	if (!(await canManageBoard(board, actor, "ADMINISTER_PROJECTS"))) {
		throw new HttpError(403, "Only board administrators can change this board");
	}
	try {
		await replaceSwimlanes(board.id, body.swimlanes, actor);
	} catch (error) {
		jqlFailure(error);
	}
	const config = await loadBoardConfig(board.rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	return boardConfig(config.board, config);
}

export async function updateBoardSwimlanes(
	actor: CurrentUser,
	rapidViewId: number,
	body: {
		swimlaneStrategy: BoardRow["swimlaneStrategy"];
		swimlanes: z.infer<typeof swimlanesBody>["swimlanes"];
	},
) {
	const board = await requireBoard(actor, rapidViewId);
	if (!(await canManageBoard(board, actor, "ADMINISTER_PROJECTS"))) {
		throw new HttpError(403, "Only board administrators can change this board");
	}
	try {
		for (const swimlane of body.swimlanes) {
			await validateJql(swimlane.jql, actor);
		}
	} catch (error) {
		jqlFailure(error);
	}
	await db.transaction(async (tx) => {
		await tx
			.update(boards)
			.set({
				swimlaneStrategy: body.swimlaneStrategy,
				configImported: true,
				updatedAt: new Date(),
			})
			.where(eq(boards.id, board.id));
		await tx.delete(boardSwimlanes).where(eq(boardSwimlanes.boardId, board.id));
		if (body.swimlanes.length > 0) {
			await tx.insert(boardSwimlanes).values(
				body.swimlanes.map((swimlane, sequence) => ({
					boardId: board.id,
					name: swimlane.name,
					jql: swimlane.jql,
					sequence,
				})),
			);
		}
	});
	const config = await loadBoardConfig(board.rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	return boardConfig(config.board, config);
}

export async function replaceBoardQuickFilters(
	actor: CurrentUser,
	rapidViewId: number,
	body: z.infer<typeof quickFiltersBody>,
) {
	const board = await requireBoard(actor, rapidViewId);
	if (!(await canManageBoard(board, actor, "ADMINISTER_PROJECTS"))) {
		throw new HttpError(403, "Only board administrators can change this board");
	}
	try {
		await replaceQuickFilters(board.id, body.quickFilters, actor);
	} catch (error) {
		jqlFailure(error);
	}
	const config = await loadBoardConfig(board.rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	return boardConfig(config.board, config);
}

export async function getBoardData(
	actor: CurrentUser,
	rapidViewId: number,
	query: z.infer<typeof searchQuery>,
) {
	await waitForBoardMoves(rapidViewId);
	await requireBoard(actor, rapidViewId);
	const config = await loadBoardConfig(rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	try {
		return await boardData(config.board, config, actor, query);
	} catch (error) {
		jqlFailure(error);
	}
}

export async function boardSprintSummary(
	actor: CurrentUser,
	rapidViewId: number,
) {
	const board = await requireBoard(actor, rapidViewId);
	const activeSprint =
		board.type === "scrum" ? await loadActiveSprint(board.id) : null;
	const futureSprintRows = await db
		.select()
		.from(sprints)
		.where(
			and(
				or(
					eq(sprints.boardId, board.id),
					sql`exists (select 1 from ${boardSprints} bs where bs.sprint_id = ${sprints.id} and bs.board_id = ${board.id})`,
				),
				eq(sprints.state, "future"),
			),
		)
		.orderBy(asc(sprints.sequence), asc(sprints.name));
	if (!activeSprint) {
		return {
			completed: 0,
			incomplete: 0,
			futureSprints: futureSprintRows.map(sprintPayload),
		};
	}
	const [counts] = await db
		.select({
			completed: sql<number>`count(*) filter (where ${statuses.category} = 'done')::int`,
			incomplete: sql<number>`count(*) filter (where ${statuses.category} <> 'done')::int`,
		})
		.from(issueSprints)
		.innerJoin(issues, eq(issues.id, issueSprints.issueId))
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.where(
			and(
				eq(issueSprints.sprintId, activeSprint.id),
				eq(issueSprints.isOpen, true),
				sql`${issues.projectId} = any(${sql.param(await viewerProjectIds(actor))}::uuid[])`,
			),
		);
	return {
		completed: counts?.completed ?? 0,
		incomplete: counts?.incomplete ?? 0,
		futureSprints: futureSprintRows.map(sprintPayload),
	};
}

export async function getBacklog(
	actor: CurrentUser,
	rapidViewId: number,
	query: z.infer<typeof searchQuery>,
) {
	await waitForBoardMoves(rapidViewId);
	await requireBoard(actor, rapidViewId);
	const config = await loadBoardConfig(rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	try {
		return await backlogData(config.board, config, actor, query);
	} catch (error) {
		jqlFailure(error);
	}
}

/** The backlog's assignee filter choices, independent of the active search. */
export async function getBacklogAssignees(
	actor: CurrentUser,
	rapidViewId: number,
) {
	await requireBoard(actor, rapidViewId);
	const config = await loadBoardConfig(rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	let conditions: SQL[];
	try {
		conditions = await boardFilterConditions(config.board, actor, {}, config);
	} catch (error) {
		jqlFailure(error);
	}
	const rows = await db
		.selectDistinct({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarUrl: userAvatarSql(users.id),
		})
		.from(issues)
		.innerJoin(users, eq(users.id, issues.assigneeId))
		.where(and(...conditions))
		.orderBy(asc(users.displayName), asc(users.username));
	return rows.map((row) => userRef(row)).filter((row) => row !== null);
}

export async function moveIssues(
	actor: CurrentUser,
	rapidViewId: number,
	body: z.infer<typeof moveBody>,
) {
	await requireBoard(actor, rapidViewId);
	const config = await loadBoardConfig(rapidViewId);
	if (!config) throw new HttpError(404, "Board not found");
	const board = config.board;
	await requireWritableBoard(board);
	const keys = [...new Set(body.issues.map((key) => key.toUpperCase()))];

	const filter = await conditionsFor(
		[board.filterJql],
		actor,
		await loadCatalog(),
	);
	const found = await withStatementTimeout((tx) =>
		tx.execute(sql`
			select issues.id, issues.key, issues.summary, issues.reporter_id, issues.assignee_id, issues.project_id, issues.type_id, issues.status_id, s.name as status_name,
				s.category as status_category, issues.resolution_id, r.name as resolution_name, issues.resolved
			from issues
			join statuses s on s.id = issues.status_id
			left join resolutions r on r.id = issues.resolution_id
			where issues.key in (${sql.join(
				keys.map((key) => sql`${key}`),
				sql`, `,
			)})
				and ${sql.join(filter.length > 0 ? filter : [sql`true`], sql` and `)}
		`),
	);
	const rows = found.rows as {
		id: string;
		key: string;
		summary: string;
		reporter_id: string | null;
		assignee_id: string | null;
		project_id: string;
		type_id: string;
		status_id: string;
		status_name: string;
		status_category: "new" | "indeterminate" | "done";
		resolution_id: string | null;
		resolution_name: string | null;
		resolved: Date | null;
	}[];
	if (rows.length !== keys.length) {
		throw new HttpError(400, "Some issues are not on this board");
	}

	let targetStatusId: string | null = null;
	let columnStatuses: StatusRow[] = [];
	if (body.columnId) {
		const column = config.columns.find((item) => item.id === body.columnId);
		if (!column) throw new HttpError(400, "Unknown column");
		columnStatuses = column.statuses;
		if (body.statusId) {
			if (!columnStatuses.some((status) => status.id === body.statusId)) {
				throw new HttpError(400, "The status is not in this column");
			}
			targetStatusId = body.statusId;
		} else if (columnStatuses.length === 1) {
			targetStatusId = columnStatuses[0].id;
		} else if (columnStatuses.length === 0) {
			throw new HttpError(400, "The column has no statuses");
		}
	}

	let epicId: string | null = null;
	if (body.epic !== undefined && body.epic !== null) {
		const [epic] = await db
			.select({ id: issues.id })
			.from(issues)
			.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
			.where(
				and(
					eq(issues.key, body.epic.toUpperCase()),
					eq(issueTypes.name, "Epic"),
				),
			)
			.limit(1);
		if (!epic) throw new HttpError(400, "Unknown epic");
		await requireBrowseIssue(actor, epic.id);
		epicId = epic.id;
	}

	const transitions = new Map<
		string,
		{
			row: (typeof rows)[number];
			transition: Awaited<ReturnType<typeof transitionsFrom>>[number];
		}
	>();
	const invalid: typeof rows = [];
	if (body.columnId) {
		for (const row of rows) {
			const issueTargetStatusId =
				targetStatusId ??
				(columnStatuses.some((status) => status.id === row.status_id)
					? row.status_id
					: null);
			if (!issueTargetStatusId) {
				invalid.push(row);
				continue;
			}
			if (row.status_id === issueTargetStatusId) continue;
			const workflow = await workflowForIssueType(row.project_id, row.type_id);
			if (!workflow) {
				invalid.push(row);
				continue;
			}
			const available = await transitionsFrom(workflow.id, row.status_id);
			const transition = available.find(
				(item) => item.to.id === issueTargetStatusId,
			);
			if (!transition) {
				invalid.push(row);
				continue;
			}
			transitions.set(row.id, { row, transition });
		}
		if (invalid.length > 0 && !targetStatusId && columnStatuses.length > 1) {
			const message = "Choose a status in this column";
			throw new HttpError(400, message, {
				details: { statuses: columnStatuses },
			});
		}
		if (invalid.length > 0) {
			const validColumns: { id: string; name: string }[] = [];
			for (const row of invalid) {
				const workflow = await workflowForIssueType(
					row.project_id,
					row.type_id,
				);
				if (!workflow) continue;
				const available = await transitionsFrom(workflow.id, row.status_id);
				const reachable = new Set(available.map((item) => item.to.id));
				reachable.add(row.status_id);
				for (const column of config.columns) {
					if (
						column.statuses.some((status) => reachable.has(status.id)) &&
						!validColumns.some((item) => item.id === column.id)
					) {
						validColumns.push({ id: column.id, name: column.name });
					}
				}
			}
			const message =
				invalid.length === 1
					? `Cannot move ${invalid[0].key} to this column`
					: `Cannot move ${invalid.length} issues to this column`;
			throw new HttpError(400, message, { details: { validColumns } });
		}
		// A board drop has no resolution dialog. A done target gets the default
		// "Done" resolution; a transition that asks for a resolution on a
		// status that is not done has no sensible default, so it is refused.
		const needsChoice = [...transitions.values()].find(
			({ transition }) =>
				transition.asksResolution && transition.to.category !== "done",
		);
		if (needsChoice) {
			throw new HttpError(
				400,
				`The transition "${needsChoice.transition.name}" asks for a resolution; open ${needsChoice.row.key} and run it from the issue`,
			);
		}
	}

	const epicOnly =
		body.epic !== undefined &&
		body.before === undefined &&
		body.after === undefined &&
		body.sprintId === undefined &&
		body.columnId === undefined;

	for (const row of rows) {
		const needed: PermissionKey[] = [];
		const transition = transitions.get(row.id)?.transition;
		if (transition) {
			needed.push("TRANSITION_ISSUES");
			const toDone = transition.to.category === "done";
			const fromDone = row.status_category === "done";
			if (toDone && !fromDone) needed.push("RESOLVE_ISSUES");
			if (!toDone && fromDone) needed.push("CLOSE_ISSUES");
		}
		if (!epicOnly) needed.push("SCHEDULE_ISSUES");
		if (body.epic !== undefined) needed.push("EDIT_ISSUES");
		for (const permission of needed) {
			await requireIssuePermissionFor(actor, row.key, permission);
		}
	}
	const targetPlan = epicOnly
		? null
		: await targetContainerPlan(board, config, actor, body);

	const transitioned: {
		row: (typeof rows)[number];
		items: HistoryItem[];
	}[] = [];
	try {
		await withStatementTimeout(async (tx) => {
			await lockBoard(tx, board.id);
			const containerRows =
				epicOnly || !targetPlan
					? []
					: await loadBoardIssueRows({
							conditions: targetPlan.conditions,
							mode: targetPlan.mode,
							sprintId: targetPlan.sprintId,
							estimationField: board.estimationField,
							user: actor,
							extraConditions: targetPlan.extra,
							executor: tx,
						});
			const movedSet = new Set(keys);
			const containerKeys = containerRows
				.map((row) => row.key)
				.filter((key) => !movedSet.has(key));
			const rankByKey = new Map(
				containerRows.map((row) => [row.key, row.rank]),
			);
			let previousKey: string | null = null;
			let nextKey: string | null = null;
			if (body.before && body.after) {
				nextKey = body.before.toUpperCase();
				previousKey = body.after.toUpperCase();
				if (!containerKeys.includes(nextKey)) {
					throw new HttpError(
						400,
						"The before issue is not in the target list",
					);
				}
				if (!containerKeys.includes(previousKey)) {
					throw new HttpError(400, "The after issue is not in the target list");
				}
			} else if (body.before) {
				nextKey = body.before.toUpperCase();
				const index = containerKeys.indexOf(nextKey);
				if (index < 0) {
					throw new HttpError(
						400,
						"The before issue is not in the target list",
					);
				}
				previousKey = containerKeys[index - 1] ?? null;
			} else if (body.after) {
				previousKey = body.after.toUpperCase();
				const index = containerKeys.indexOf(previousKey);
				if (index < 0) {
					throw new HttpError(400, "The after issue is not in the target list");
				}
				nextKey = containerKeys[index + 1] ?? null;
			} else {
				previousKey = containerKeys[containerKeys.length - 1] ?? null;
			}
			const previousRank = previousKey
				? (rankByKey.get(previousKey) ?? null)
				: null;
			const nextRank = nextKey ? (rankByKey.get(nextKey) ?? null) : null;
			let ranks: string[] = [];
			if (!epicOnly) {
				try {
					ranks = ranksBetween(previousRank, nextRank, keys.length);
				} catch {
					throw new HttpError(400, "Cannot place issues at that position");
				}
			}
			for (const [index, key] of keys.entries()) {
				const row = rows.find((item) => item.key === key);
				if (!row) continue;
				const pending = transitions.get(row.id);
				if (pending) {
					const items = await applyTransition(
						tx,
						{
							id: row.id,
							statusId: row.status_id,
							statusName: row.status_name,
							statusCategory: row.status_category,
							resolutionId: row.resolution_id,
							resolutionName: row.resolution_name,
							resolved: row.resolved,
						},
						pending.transition,
						actor.id,
					);
					if (!items) throw new StaleStatusError();
					transitioned.push({ row, items });
				}
				if (!epicOnly) {
					await tx
						.update(issues)
						.set({ rank: ranks[index] })
						.where(eq(issues.id, row.id));
				}
				if (body.epic !== undefined) {
					await tx.update(issues).set({ epicId }).where(eq(issues.id, row.id));
				}
			}
			if (targetPlan?.writesSprint) {
				await tx.delete(issueSprints).where(
					and(
						inArray(
							issueSprints.issueId,
							rows.map((row) => row.id),
						),
						eq(issueSprints.isOpen, true),
					),
				);
				if (targetPlan.sprintId) {
					await tx
						.insert(issueSprints)
						.values(
							rows.map((row) => ({
								issueId: row.id,
								sprintId: targetPlan.sprintId as string,
								isOpen: true,
							})),
						)
						.onConflictDoUpdate({
							target: [issueSprints.issueId, issueSprints.sprintId],
							set: { isOpen: true },
						});
				}
			}
		});
	} catch (error) {
		if (error instanceof StaleStatusError) {
			throw new HttpError(
				409,
				"An issue changed status in the meantime. Reload the board.",
			);
		}
		throw error;
	}

	for (const { row, items } of transitioned) {
		await recomputeIssueSla(row.id);
		await recordIssueEvent({
			issue: {
				id: row.id,
				key: row.key,
				summary: row.summary,
				reporterId: row.reporter_id,
				assigneeId: row.assignee_id,
			},
			actor,
			kind: "transitioned",
			changes: items.map((item) => ({
				field: item.field === "status" ? "Status" : "Resolution",
				from: item.fromText,
				to: item.toText,
			})),
		});
	}

	return { moved: keys.length };
}

export async function createSprint(
	actor: CurrentUser,
	rapidViewId: number,
	body: z.infer<typeof sprintCreateBody>,
) {
	const board = await requireBoard(actor, rapidViewId);
	await requireWritableBoard(board);
	if (!(await canManageBoard(board, actor, "MANAGE_SPRINTS_PERMISSION"))) {
		throw new HttpError(403, "Only board administrators can manage sprints");
	}
	if (board.type !== "scrum") {
		throw new HttpError(400, "Kanban boards have no sprints");
	}
	const created = await db.transaction(async (tx) => {
		await lockBoard(tx, board.id);
		const [last] = await tx
			.select({ sequence: sprints.sequence })
			.from(sprints)
			.where(eq(sprints.boardId, board.id))
			.orderBy(desc(sprints.sequence))
			.limit(1);
		const [row] = await tx
			.insert(sprints)
			.values({
				boardId: board.id,
				name: body.name,
				goal: body.goal ?? null,
				state: "future",
				startDate: body.startDate ? new Date(body.startDate) : null,
				endDate: body.endDate ? new Date(body.endDate) : null,
				sequence: (last?.sequence ?? 0) + 1,
			})
			.returning();
		return row;
	});
	return sprintPayload(created);
}

function nextSprintDate(
	value: string | null | undefined,
	current: Date | null,
) {
	if (value === undefined) return current;
	return value === null ? null : new Date(value);
}

function sprintDateChanged(
	value: string | null | undefined,
	current: Date | null,
) {
	if (value === undefined) return false;
	if (value === null) return current !== null;
	return current === null || new Date(value).getTime() !== current.getTime();
}

export async function updateSprint(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof sprintPatchBody>,
) {
	const [sprint] = await db
		.select()
		.from(sprints)
		.where(eq(sprints.id, id))
		.limit(1);
	if (!sprint) throw new HttpError(404, "Sprint not found");
	const board = await requireSprintBoard(actor, sprint.boardId);
	await requireWritableBoard(board);
	const managesSprints = await canManageBoard(
		board,
		actor,
		"MANAGE_SPRINTS_PERMISSION",
	);
	const changesName = body.name !== undefined && body.name !== sprint.name;
	const changesGoal = body.goal !== undefined && body.goal !== sprint.goal;
	const changesDates =
		sprintDateChanged(body.startDate, sprint.startDate) ||
		sprintDateChanged(body.endDate, sprint.endDate) ||
		(body.sequence !== undefined && body.sequence !== sprint.sequence);
	if (!managesSprints) {
		if (changesDates || (!changesName && !changesGoal)) {
			throw new HttpError(403, "Only board administrators can manage sprints");
		}
		if (
			!(await canManageBoard(
				board,
				actor,
				"EDIT_SPRINT_NAME_AND_GOAL_PERMISSION",
			))
		) {
			throw new HttpError(
				403,
				"You do not have permission to change the sprint name or goal",
			);
		}
	}
	if (sprint.state === "closed") {
		throw new HttpError(400, "A closed sprint cannot be edited");
	}
	const nextStartDate = nextSprintDate(body.startDate, sprint.startDate);
	const nextEndDate = nextSprintDate(body.endDate, sprint.endDate);
	if (nextStartDate && nextEndDate && nextEndDate <= nextStartDate) {
		throw new HttpError(400, "The end date must be after the start date");
	}
	const [updated] = await db
		.update(sprints)
		.set({
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.goal !== undefined ? { goal: body.goal } : {}),
			...(body.startDate !== undefined
				? { startDate: body.startDate ? new Date(body.startDate) : null }
				: {}),
			...(body.endDate !== undefined
				? { endDate: body.endDate ? new Date(body.endDate) : null }
				: {}),
			...(body.sequence !== undefined ? { sequence: body.sequence } : {}),
			updatedAt: new Date(),
		})
		.where(eq(sprints.id, sprint.id))
		.returning();
	return sprintPayload(updated);
}

export async function startSprint(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof sprintStartBody>,
) {
	const [sprint] = await db
		.select()
		.from(sprints)
		.where(eq(sprints.id, id))
		.limit(1);
	if (!sprint) throw new HttpError(404, "Sprint not found");
	const board = await requireSprintBoard(actor, sprint.boardId);
	await requireWritableBoard(board);
	const managesSprints = await canManageBoard(
		board,
		actor,
		"MANAGE_SPRINTS_PERMISSION",
	);
	if (
		!managesSprints &&
		!(await canManageBoard(board, actor, "START_STOP_SPRINTS_PERMISSION"))
	) {
		throw new HttpError(403, "Only board administrators can manage sprints");
	}
	const changesName = body.name !== undefined && body.name !== sprint.name;
	const changesGoal = body.goal !== undefined && body.goal !== sprint.goal;
	if (
		!managesSprints &&
		(changesName || changesGoal) &&
		!(await canManageBoard(
			board,
			actor,
			"EDIT_SPRINT_NAME_AND_GOAL_PERMISSION",
		))
	) {
		throw new HttpError(
			403,
			"You do not have permission to change the sprint name or goal",
		);
	}
	const startDate = new Date(body.startDate);
	const endDate = new Date(body.endDate);
	if (endDate <= startDate) {
		throw new HttpError(400, "The end date must be after the start date");
	}
	const updated = await db.transaction(async (tx) => {
		await lockBoard(tx, board.id);
		const [current] = await tx
			.select()
			.from(sprints)
			.where(eq(sprints.id, id))
			.limit(1);
		if (!current) throw new HttpError(404, "Sprint not found");
		if (current.state !== "future") {
			throw new HttpError(400, "Only a future sprint can be started");
		}
		const active = await loadActiveSprint(board.id);
		if (active) {
			throw new HttpError(400, "This board already has an active sprint");
		}
		const [row] = await tx
			.update(sprints)
			.set({
				state: "active",
				startDate,
				endDate,
				...(body.name !== undefined ? { name: body.name } : {}),
				goal: body.goal !== undefined ? body.goal : current.goal,
				updatedAt: new Date(),
			})
			.where(eq(sprints.id, current.id))
			.returning();
		return row;
	});
	return sprintPayload(updated);
}

export async function completeSprint(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof sprintCompleteBody>,
) {
	const [sprint] = await db
		.select()
		.from(sprints)
		.where(eq(sprints.id, id))
		.limit(1);
	if (!sprint) throw new HttpError(404, "Sprint not found");
	const board = await requireSprintBoard(actor, sprint.boardId);
	if (board.projectId) {
		const [project] = await db
			.select({ archived: projects.archived })
			.from(projects)
			.where(eq(projects.id, board.projectId))
			.limit(1);
		if (project?.archived) {
			throw new HttpError(403, "This project is archived and read-only");
		}
	}
	if (
		!(await canManageBoard(board, actor, "MANAGE_SPRINTS_PERMISSION")) &&
		!(await canManageBoard(board, actor, "START_STOP_SPRINTS_PERMISSION"))
	) {
		throw new HttpError(403, "Only board administrators can manage sprints");
	}
	if (sprint.state !== "active") {
		throw new HttpError(400, "Only an active sprint can be completed");
	}
	let targetSprintId: string | null = null;
	if (body.moveToSprintId) {
		const [target] = await db
			.select()
			.from(sprints)
			.where(eq(sprints.id, body.moveToSprintId))
			.limit(1);
		if (!target || target.boardId !== board.id) {
			throw new HttpError(400, "Unknown target sprint");
		}
		if (target.state !== "future") {
			throw new HttpError(
				400,
				"Unfinished issues can only move to a future sprint",
			);
		}
		targetSprintId = target.id;
	}
	const result = await db.transaction(async (tx) => {
		await lockBoard(tx, board.id);
		const [current] = await tx
			.select()
			.from(sprints)
			.where(eq(sprints.id, id))
			.limit(1);
		if (!current) throw new HttpError(404, "Sprint not found");
		if (current.state !== "active") {
			throw new HttpError(400, "Only an active sprint can be completed");
		}
		const issueRows = await tx
			.select({
				id: issues.id,
				done: sql<boolean>`${statuses.category} = 'done'`,
			})
			.from(issueSprints)
			.innerJoin(issues, eq(issues.id, issueSprints.issueId))
			.innerJoin(statuses, eq(statuses.id, issues.statusId))
			.where(
				and(
					eq(issueSprints.sprintId, current.id),
					eq(issueSprints.isOpen, true),
				),
			);
		const incompleteRows = issueRows.filter((row) => !row.done);
		const [closed] = await tx
			.update(sprints)
			.set({
				state: "closed",
				completeDate: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(sprints.id, current.id))
			.returning();
		if (!closed) throw new HttpError(404, "Sprint not found");
		await tx
			.update(issueSprints)
			.set({ isOpen: false })
			.where(eq(issueSprints.sprintId, current.id));
		if (targetSprintId && incompleteRows.length > 0) {
			await tx
				.insert(issueSprints)
				.values(
					incompleteRows.map((row) => ({
						issueId: row.id,
						sprintId: targetSprintId as string,
						isOpen: true,
					})),
				)
				.onConflictDoUpdate({
					target: [issueSprints.issueId, issueSprints.sprintId],
					set: { isOpen: true },
				});
		}
		return {
			sprint: closed,
			completed: issueRows.filter((row) => row.done).length,
			incomplete: incompleteRows.length,
		};
	});
	return {
		sprint: sprintPayload(result.sprint),
		completed: result.completed,
		incomplete: result.incomplete,
		movedToSprintId: targetSprintId,
	};
}

export async function deleteSprint(actor: CurrentUser, id: string) {
	const [sprint] = await db
		.select()
		.from(sprints)
		.where(eq(sprints.id, id))
		.limit(1);
	if (!sprint) throw new HttpError(404, "Sprint not found");
	const board = await requireSprintBoard(actor, sprint.boardId);
	await requireWritableBoard(board);
	if (!(await canManageBoard(board, actor, "MANAGE_SPRINTS_PERMISSION"))) {
		throw new HttpError(403, "Only board administrators can manage sprints");
	}
	if (sprint.state !== "future") {
		throw new HttpError(400, "Only a future sprint can be deleted");
	}
	await db.transaction(async (tx) => {
		await lockBoard(tx, board.id);
		const [current] = await tx
			.select()
			.from(sprints)
			.where(eq(sprints.id, id))
			.limit(1);
		if (!current) throw new HttpError(404, "Sprint not found");
		if (current.state !== "future") {
			throw new HttpError(400, "Only a future sprint can be deleted");
		}
		await tx.delete(sprints).where(eq(sprints.id, current.id));
	});
}

export async function moveSprint(
	actor: CurrentUser,
	id: string,
	body: { direction: "up" | "down" },
) {
	const [sprint] = await db
		.select()
		.from(sprints)
		.where(eq(sprints.id, id))
		.limit(1);
	if (!sprint) throw new HttpError(404, "Sprint not found");
	const board = await requireSprintBoard(actor, sprint.boardId);
	await requireWritableBoard(board);
	if (!(await canManageBoard(board, actor, "MANAGE_SPRINTS_PERMISSION"))) {
		throw new HttpError(403, "Only board administrators can manage sprints");
	}
	if (sprint.state === "closed") {
		throw new HttpError(400, "A closed sprint cannot be moved");
	}
	await db.transaction(async (tx) => {
		await lockBoard(tx, board.id);
		const [current] = await tx
			.select()
			.from(sprints)
			.where(eq(sprints.id, id))
			.limit(1);
		if (!current) throw new HttpError(404, "Sprint not found");
		if (current.state === "closed") {
			throw new HttpError(400, "A closed sprint cannot be moved");
		}
		const list = await tx
			.select()
			.from(sprints)
			.where(
				and(
					eq(sprints.boardId, current.boardId),
					inArray(sprints.state, ["active", "future"]),
				),
			)
			.orderBy(asc(sprints.sequence), asc(sprints.name));
		const index = list.findIndex((item) => item.id === current.id);
		const swapIndex = body.direction === "up" ? index - 1 : index + 1;
		if (swapIndex < 0 || swapIndex >= list.length) {
			throw new HttpError(400, "The sprint is already at the end of the list");
		}
		const other = list[swapIndex];
		await tx
			.update(sprints)
			.set({ sequence: other.sequence, updatedAt: new Date() })
			.where(eq(sprints.id, current.id));
		await tx
			.update(sprints)
			.set({ sequence: current.sequence, updatedAt: new Date() })
			.where(eq(sprints.id, other.id));
	});
	const updated = await db
		.select()
		.from(sprints)
		.where(eq(sprints.boardId, sprint.boardId))
		.orderBy(asc(sprints.sequence), asc(sprints.name));
	return updated.map(sprintPayload);
}
