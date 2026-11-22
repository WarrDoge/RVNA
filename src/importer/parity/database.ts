import { getTableColumns, getTableName } from "drizzle-orm";
import type pg from "pg";
import {
	boardSprints,
	boards,
	issueSprints,
	sprints,
} from "../../lib/server/schema.ts";
import type {
	JiraAgileData,
	JiraBoardData,
	JiraDatabaseSnapshot,
	JiraFilterData,
	JiraIssueData,
	JiraProjectWorkflowData,
	JiraServiceDeskData,
	ParityDatabase,
	TableSet,
	WikiAttachmentData,
	WikiDatabaseSnapshot,
	WikiPageData,
} from "./types.ts";

interface TableColumnRow {
	table_name: string;
	column_name: string;
}

function identifier(value: string) {
	if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
		throw new Error(`Unexpected database identifier: ${value}`);
	}
	return `"${value}"`;
}

export async function loadTableSet(pool: pg.Pool): Promise<TableSet> {
	const { rows } = await pool.query<TableColumnRow>(
		`
		select table_name, column_name
		from information_schema.columns
		where table_schema = current_schema()
		order by table_name, ordinal_position
		`,
	);
	const columns = new Map<string, Set<string>>();
	for (const row of rows) {
		const set = columns.get(row.table_name) ?? new Set<string>();
		set.add(row.column_name);
		columns.set(row.table_name, set);
	}
	return {
		has(table) {
			return columns.has(table);
		},
		columns(table) {
			return columns.get(table);
		},
		hasColumns(table, wanted) {
			const available = columns.get(table);
			return (
				available !== undefined &&
				wanted.every((column) => available.has(column))
			);
		},
	};
}

async function loadJiraAgile(
	pool: pg.Pool,
	tables: TableSet,
): Promise<JiraAgileData | null> {
	const boardTable = getTableName(boards);
	const sprintTable = getTableName(sprints);
	const membershipTable = getTableName(issueSprints);
	const board = getTableColumns(boards);
	const sprint = getTableColumns(sprints);
	const membership = getTableColumns(issueSprints);

	if (
		!tables.hasColumns(boardTable, [
			board.id.name,
			board.rapidViewId.name,
			board.sourceId.name,
		]) ||
		!tables.hasColumns(sprintTable, [
			sprint.id.name,
			sprint.sourceId.name,
			sprint.boardId.name,
			sprint.state.name,
		]) ||
		!tables.hasColumns(membershipTable, [
			membership.issueId.name,
			membership.sprintId.name,
		])
	) {
		return null;
	}

	const boardRows = await pool.query<{
		row_id: string;
		source_id: string | null;
		rapid_view_id: number;
	}>(
		`
		select ${identifier(board.id.name)}::text as row_id,
		       ${identifier(board.sourceId.name)} as source_id,
		       ${identifier(board.rapidViewId.name)} as rapid_view_id
		from ${identifier(boardTable)}
		order by ${identifier(board.rapidViewId.name)}
		`,
	);
	const boardByRowId = new Map<string, string>();
	const boardsById = new Map<string, JiraBoardData>();
	for (const row of boardRows.rows) {
		const id = row.source_id ?? String(row.rapid_view_id);
		boardByRowId.set(row.row_id, id);
		if (!boardsById.has(id)) boardsById.set(id, { id, sprints: [] });
	}

	// A sprint can sit on several boards; board_sprints (when present) lists them all.
	const sharedTable = getTableName(boardSprints);
	const shared = getTableColumns(boardSprints);
	const hasShared = tables.hasColumns(sharedTable, [
		shared.boardId.name,
		shared.sprintId.name,
	]);
	const links = hasShared
		? `select ${identifier(sprint.id.name)} as sprint_id, ${identifier(sprint.boardId.name)} as board_id from ${identifier(sprintTable)}
		   union
		   select ${identifier(shared.sprintId.name)}, ${identifier(shared.boardId.name)} from ${identifier(sharedTable)}`
		: `select ${identifier(sprint.id.name)} as sprint_id, ${identifier(sprint.boardId.name)} as board_id from ${identifier(sprintTable)}`;
	const sprintRows = await pool.query<{
		row_id: string;
		source_id: string | null;
		board_ref: string;
		state: string;
		issue_count: number;
	}>(
		`
		select sprint.${identifier(sprint.id.name)}::text as row_id,
		       sprint.${identifier(sprint.sourceId.name)} as source_id,
		       link.board_id::text as board_ref,
		       sprint.${identifier(sprint.state.name)} as state,
		       count(membership.${identifier(membership.issueId.name)})::int as issue_count
		from ${identifier(sprintTable)} sprint
		join (${links}) link on link.sprint_id = sprint.${identifier(sprint.id.name)}
		left join ${identifier(membershipTable)} membership
		  on membership.${identifier(membership.sprintId.name)} = sprint.${identifier(sprint.id.name)}
		group by sprint.${identifier(sprint.id.name)},
		         sprint.${identifier(sprint.sourceId.name)},
		         link.board_id,
		         sprint.${identifier(sprint.state.name)}
		order by sprint.${identifier(sprint.sourceId.name)} nulls last,
		         sprint.${identifier(sprint.id.name)}
		`,
	);
	for (const row of sprintRows.rows) {
		const boardId = boardByRowId.get(row.board_ref);
		if (!boardId) continue;
		boardsById.get(boardId)?.sprints.push({
			id: row.source_id ?? row.row_id,
			state: row.state,
			issueCount: row.issue_count,
		});
	}

	return { boards: [...boardsById.values()] };
}

async function loadJiraServiceDesks(
	pool: pg.Pool,
	tables: TableSet,
	projectKeys?: string[],
): Promise<JiraServiceDeskData[] | null> {
	if (
		!tables.hasColumns("service_desks", ["source_id", "project_id"]) ||
		!tables.hasColumns("request_types", ["source_id", "desk_id"]) ||
		!tables.hasColumns("queues", [
			"source_id",
			"desk_id",
			"jql",
			"issue_count",
		]) ||
		!tables.hasColumns("sla_metrics", ["source_id", "desk_id"])
	) {
		return null;
	}
	const deskFilter =
		projectKeys && projectKeys.length > 0
			? "where project.key = any($1::text[])"
			: "";
	const desks = await pool.query<{
		source_id: string;
		project_key: string;
	}>(
		`
		select desk.source_id, project.key as project_key
		from service_desks desk
		join projects project on project.id = desk.project_id
		${deskFilter}
		order by project.key
		`,
		deskFilter ? [projectKeys] : [],
	);
	const requestTypes = await pool.query<{
		desk_source_id: string;
		source_id: string;
	}>(
		`
		select desk.source_id as desk_source_id, request_type.source_id
		from request_types request_type
		join service_desks desk on desk.id = request_type.desk_id
		`,
	);
	const queues = await pool.query<{
		desk_source_id: string;
		source_id: string;
		jql: string;
		issue_count: number | null;
	}>(
		`
		select desk.source_id as desk_source_id, queue.source_id, queue.jql, queue.issue_count
		from queues queue
		join service_desks desk on desk.id = queue.desk_id
		`,
	);
	const metrics = await pool.query<{
		desk_source_id: string;
		source_id: string;
	}>(
		`
		select desk.source_id as desk_source_id, metric.source_id
		from sla_metrics metric
		join service_desks desk on desk.id = metric.desk_id
		`,
	);

	const result = new Map<string, JiraServiceDeskData>();
	for (const desk of desks.rows) {
		result.set(desk.source_id, {
			sourceId: desk.source_id,
			projectKey: desk.project_key,
			requestTypes: [],
			queues: [],
			metrics: [],
		});
	}
	for (const row of requestTypes.rows) {
		result.get(row.desk_source_id)?.requestTypes.push(row.source_id);
	}
	for (const row of queues.rows) {
		result.get(row.desk_source_id)?.queues.push({
			id: row.source_id,
			jql: row.jql,
			issueCount: row.issue_count,
		});
	}
	for (const row of metrics.rows) {
		result.get(row.desk_source_id)?.metrics.push(row.source_id);
	}
	return [...result.values()];
}

async function loadJiraFilters(
	pool: pg.Pool,
	tables: TableSet,
): Promise<JiraFilterData[] | null> {
	if (!tables.hasColumns("filters", ["source_id", "name", "jql"])) return null;
	const { rows } = await pool.query<{
		source_id: string;
		name: string;
		jql: string;
	}>(
		"select source_id, name, jql from filters where source_id is not null order by source_id",
	);
	return rows.map((row) => ({
		id: row.source_id,
		name: row.name,
		jql: row.jql,
	}));
}

async function loadWorkflowResolutionTransitions(
	pool: pg.Pool,
	tables: TableSet,
): Promise<Map<string, string[]> | null> {
	if (
		!tables.hasColumns("workflows", ["id", "name"]) ||
		!tables.hasColumns("workflow_transitions", [
			"workflow_id",
			"source_id",
			"asks_resolution",
		])
	) {
		return null;
	}
	const { rows } = await pool.query<{
		workflow: string;
		source_id: string | null;
		asks_resolution: boolean;
	}>(
		`
		select workflow.name as workflow,
		       transition.source_id,
		       transition.asks_resolution
		from workflows workflow
		left join workflow_transitions transition
		  on transition.workflow_id = workflow.id
		order by workflow.name, transition.source_id
		`,
	);
	const result = new Map<string, string[]>();
	for (const row of rows) {
		const transitions = result.get(row.workflow) ?? [];
		if (row.asks_resolution && row.source_id) {
			transitions.push(row.source_id);
		}
		result.set(row.workflow, transitions);
	}
	return result;
}

export async function loadJiraSnapshot(
	pool: pg.Pool,
	tables: TableSet,
	options: { projectKeys?: string[] } = {},
): Promise<JiraDatabaseSnapshot> {
	const projectFilter =
		options.projectKeys && options.projectKeys.length > 0
			? `where project.key = any($1::text[])`
			: "";
	const projectParams = [options.projectKeys ?? []];
	const projects = await pool.query<{ key: string }>(
		`select key from projects project ${projectFilter} order by key`,
		projectFilter ? projectParams : [],
	);
	const localIssues = new Set<string>();
	if (tables.hasColumns("issues", ["locally_changed_at"])) {
		const rows = await pool.query<{ key: string }>(
			`select key from issues
			 where locally_changed_at is not null
			    or source_id like 'fat:%' or source_id like 'local:%'`,
		);
		for (const row of rows.rows) localIssues.add(row.key);
	}
	const issueFilter =
		options.projectKeys && options.projectKeys.length > 0
			? `where project.key = any($1::text[])`
			: "";
	const issueRows = await pool.query<{
		key: string;
		number: number;
		project_key: string;
		status: string;
		resolution: string | null;
		assignee: string | null;
		updated: Date | null;
		comments: number;
		worklogs: number;
		attachments: number;
		attachment_bytes: number;
		links: number;
		watchers: number;
		subtasks: number;
		history: number;
	}>(
		`
		select issue.key,
		       issue.number,
		       project.key as project_key,
		       status.source_id as status,
		       resolution.source_id as resolution,
		       coalesce(assignee.source_key, assignee.username) as assignee,
		       issue.updated,
		       (select count(*)::int from comments comment where comment.issue_id = issue.id) as comments,
		       (select count(*)::int from worklogs worklog where worklog.issue_id = issue.id) as worklogs,
		       (select count(*)::int from attachments attachment where attachment.issue_id = issue.id) as attachments,
		       (select coalesce(sum(attachment.size), 0)::float8 from attachments attachment where attachment.issue_id = issue.id) as attachment_bytes,
		       (select count(*)::int from issue_links link where link.source_issue_id = issue.id or link.target_issue_id = issue.id) as links,
		       (select count(*)::int from watchers watcher where watcher.issue_id = issue.id) as watchers,
		       (select count(*)::int from issues child where child.parent_id = issue.id) as subtasks,
		       (select count(*)::int from issue_history history where history.issue_id = issue.id) as history
		from issues issue
		join projects project on project.id = issue.project_id
		join statuses status on status.id = issue.status_id
		left join resolutions resolution on resolution.id = issue.resolution_id
		left join users assignee on assignee.id = issue.assignee_id
		${issueFilter}
		order by issue.key
		`,
		issueFilter ? projectParams : [],
	);
	const issues = new Map<string, JiraIssueData>();
	for (const row of issueRows.rows) {
		issues.set(row.key, {
			key: row.key,
			number: row.number,
			projectKey: row.project_key,
			status: row.status,
			resolution: row.resolution,
			assignee: row.assignee,
			updated: row.updated ? row.updated.toISOString() : null,
			comments: row.comments,
			worklogs: row.worklogs,
			attachments: row.attachments,
			attachmentBytes: row.attachment_bytes,
			links: row.links,
			watchers: row.watchers,
			subtasks: row.subtasks,
			history: row.history,
		});
	}

	const users = await pool.query<{
		source_key: string;
		username: string;
		active: boolean;
	}>(
		`
		select source_key, username, active
		from users
		where source_key is not null
		order by username
		`,
	);
	const issueTypes = await pool.query<{ source_id: string }>(
		"select source_id from issue_types order by source_id",
	);
	const statuses = await pool.query<{ source_id: string }>(
		"select source_id from statuses order by source_id",
	);
	const priorities = await pool.query<{ source_id: string }>(
		"select source_id from priorities order by source_id",
	);
	const resolutions = await pool.query<{ source_id: string }>(
		"select source_id from resolutions order by source_id",
	);
	const linkTypes = await pool.query<{ source_id: string }>(
		"select source_id from link_types order by source_id",
	);

	const versionFilter =
		options.projectKeys && options.projectKeys.length > 0
			? "where project.key = any($1::text[])"
			: "";
	const versions = await pool.query<{
		project_key: string;
		source_id: string;
	}>(
		`
		select project.key as project_key, version.source_id
		from versions version
		join projects project on project.id = version.project_id
		${versionFilter}
		order by project.key, version.source_id
		`,
		versionFilter ? projectParams : [],
	);
	const components = await pool.query<{
		project_key: string;
		source_id: string;
	}>(
		`
		select project.key as project_key, component.source_id
		from components component
		join projects project on project.id = component.project_id
		${versionFilter}
		order by project.key, component.source_id
		`,
		versionFilter ? projectParams : [],
	);
	const versionsByProject = new Map<string, string[]>();
	const componentsByProject = new Map<string, string[]>();
	for (const row of versions.rows) {
		const list = versionsByProject.get(row.project_key) ?? [];
		list.push(row.source_id);
		versionsByProject.set(row.project_key, list);
	}
	for (const row of components.rows) {
		const list = componentsByProject.get(row.project_key) ?? [];
		list.push(row.source_id);
		componentsByProject.set(row.project_key, list);
	}

	const workflowRows = await pool.query<{
		project_key: string;
		issue_type_source_id: string | null;
		statuses: string[];
	}>(
		`
		select project.key as project_key,
		       issue_type.source_id as issue_type_source_id,
		       coalesce(
		         array_agg(status.source_id order by status.source_id)
		           filter (where status.source_id is not null),
		         '{}'
		       ) as statuses
		from project_workflows project_workflow
		join projects project on project.id = project_workflow.project_id
		join workflows workflow on workflow.id = project_workflow.workflow_id
		left join issue_types issue_type on issue_type.id = project_workflow.issue_type_id
		left join workflow_statuses workflow_status on workflow_status.workflow_id = workflow.id
		left join statuses status on status.id = workflow_status.status_id
		${versionFilter}
		group by project.key, issue_type.source_id, workflow.id
		order by project.key, issue_type.source_id nulls first
		`,
		versionFilter ? projectParams : [],
	);
	const projectWorkflows: JiraProjectWorkflowData[] = workflowRows.rows.map(
		(row) => ({
			projectKey: row.project_key,
			issueTypeSourceId: row.issue_type_source_id,
			statuses: row.statuses,
		}),
	);

	return {
		projects: projects.rows.map((row) => row.key),
		localIssues,
		issues,
		users: users.rows.map((row) => ({
			key: row.source_key,
			username: row.username,
			active: row.active,
		})),
		issueTypes: issueTypes.rows.map((row) => row.source_id),
		statuses: statuses.rows.map((row) => row.source_id),
		priorities: priorities.rows.map((row) => row.source_id),
		resolutions: resolutions.rows.map((row) => row.source_id),
		linkTypes: linkTypes.rows.map((row) => row.source_id),
		versionsByProject,
		componentsByProject,
		projectWorkflows,
		workflowResolutionTransitions: await loadWorkflowResolutionTransitions(
			pool,
			tables,
		),
		serviceDesks: await loadJiraServiceDesks(pool, tables, options.projectKeys),
		agile: await loadJiraAgile(pool, tables),
		filters: await loadJiraFilters(pool, tables),
	};
}

export async function loadWikiSnapshot(
	pool: pg.Pool,
	tables: TableSet,
	options: { spaceKeys?: string[] } = {},
): Promise<WikiDatabaseSnapshot | null> {
	if (!tables.has("spaces") || !tables.has("pages")) return null;
	const spaceFilter =
		options.spaceKeys && options.spaceKeys.length > 0
			? "where key = any($1::text[])"
			: "";
	const spaceParams = [options.spaceKeys ?? []];
	const spaces = await pool.query<{
		key: string;
		source_id: string;
		status: string;
	}>(
		`select key, source_id, status from spaces ${spaceFilter} order by key`,
		spaceFilter ? spaceParams : [],
	);
	const localPages = new Set<string>();
	if (tables.hasColumns("pages", ["locally_changed_at"])) {
		const rows = await pool.query<{ source_id: string }>(
			`select source_id from pages
			 where locally_changed_at is not null
			    or source_id like 'fat:%' or source_id like 'local:%'`,
		);
		for (const row of rows.rows) localPages.add(row.source_id);
	}
	if (tables.has("page_versions")) {
		const rows = await pool.query<{ source_id: string }>(
			`select distinct page.source_id
			 from page_versions version join pages page on page.id = version.page_id
			 where version.source_id like 'fat:%'`,
		);
		for (const row of rows.rows) localPages.add(row.source_id);
	}
	const pageFilter =
		options.spaceKeys && options.spaceKeys.length > 0
			? "where space.key = any($1::text[])"
			: "";
	const pageRows = await pool.query<{
		source_id: string;
		space_key: string;
		status: "current" | "draft" | "trashed";
		type: "page" | "blogpost";
		parent_source_id: string | null;
		position: number;
		title: string;
	}>(
		`
		select page.source_id,
		       space.key as space_key,
		       page.status,
		       page.type,
		       parent.source_id as parent_source_id,
		       page.position,
		       page.title
		from pages page
		join spaces space on space.id = page.space_id
		left join pages parent on parent.id = page.parent_id
		${pageFilter}
		order by space.key, page.source_id
		`,
		pageFilter ? spaceParams : [],
	);
	const pages = new Map<string, WikiPageData>();
	for (const row of pageRows.rows) {
		pages.set(row.source_id, {
			sourceId: row.source_id,
			spaceKey: row.space_key,
			status: row.status,
			type: row.type,
			parentSourceId: row.parent_source_id,
			position: row.position,
			title: row.title,
		});
	}

	const wikiFilter =
		options.spaceKeys && options.spaceKeys.length > 0
			? "where space.key = any($1::text[])"
			: "";
	const versions = new Map<string, number>();
	if (tables.has("page_versions")) {
		const rows = await pool.query<{ page_source_id: string; count: number }>(
			`
			select page.source_id as page_source_id, count(*)::int as count
			from page_versions version
			join pages page on page.id = version.page_id
			join spaces space on space.id = page.space_id
			where version.source_id not like 'fat:%'
			  and version.source_id not like 'local:%'
			  ${wikiFilter ? "and space.key = any($1::text[])" : ""}
			group by page.source_id
			`,
			wikiFilter ? spaceParams : [],
		);
		for (const row of rows.rows) versions.set(row.page_source_id, row.count);
	}

	const comments = new Map<string, { page: number; inline: number }>();
	if (tables.has("page_comments")) {
		const rows = await pool.query<{
			page_source_id: string;
			page: number;
			inline: number;
		}>(
			`
			select page.source_id as page_source_id,
			       (count(*) filter (where not comment.inline))::int as page,
			       (count(*) filter (where comment.inline))::int as inline
			from page_comments comment
			join pages page on page.id = comment.page_id
			join spaces space on space.id = page.space_id
			${wikiFilter}
			group by page.source_id
			`,
			wikiFilter ? spaceParams : [],
		);
		for (const row of rows.rows)
			comments.set(row.page_source_id, {
				page: row.page,
				inline: row.inline,
			});
	}

	const attachments = new Map<string, WikiAttachmentData[]>();
	if (tables.has("page_attachments")) {
		const rows = await pool.query<{
			page_source_id: string;
			source_id: string;
			size: number;
			sha256: string;
		}>(
			`
			select page.source_id as page_source_id, attachment.source_id, attachment.size, attachment.sha256
			from page_attachments attachment
			join pages page on page.id = attachment.page_id
			join spaces space on space.id = page.space_id
			${wikiFilter}
			`,
			wikiFilter ? spaceParams : [],
		);
		for (const row of rows.rows) {
			const list = attachments.get(row.page_source_id) ?? [];
			list.push({
				sourceId: row.source_id,
				size: row.size,
				sha256: row.sha256,
			});
			attachments.set(row.page_source_id, list);
		}
	}

	const labels = new Map<string, string[]>();
	if (tables.has("page_labels")) {
		const rows = await pool.query<{ page_source_id: string; label: string }>(
			`
			select page.source_id as page_source_id, label.label
			from page_labels label
			join pages page on page.id = label.page_id
			join spaces space on space.id = page.space_id
			${wikiFilter}
			order by page.source_id, label.label
			`,
			wikiFilter ? spaceParams : [],
		);
		for (const row of rows.rows) {
			const list = labels.get(row.page_source_id) ?? [];
			list.push(row.label);
			labels.set(row.page_source_id, list);
		}
	}

	const restrictions = new Map<string, string[]>();
	if (tables.has("page_restrictions")) {
		const rows = await pool.query<{
			page_source_id: string;
			operation: string;
			username: string | null;
			group_name: string | null;
		}>(
			`
			select page.source_id as page_source_id, restriction.operation,
			       subject.username, restriction.group_name
			from page_restrictions restriction
			join pages page on page.id = restriction.page_id
			join spaces space on space.id = page.space_id
			left join users subject on subject.id = restriction.user_id
			${wikiFilter}
			`,
			wikiFilter ? spaceParams : [],
		);
		for (const row of rows.rows) {
			const subject = row.group_name
				? `group:${row.group_name}`
				: row.username
					? `user:${row.username}`
					: null;
			if (!subject) continue;
			const list = restrictions.get(row.page_source_id) ?? [];
			list.push(`${row.operation}:${subject}`);
			restrictions.set(row.page_source_id, list);
		}
	}

	const permissions = new Map<string, string[]>();
	if (tables.has("space_permissions")) {
		const rows = await pool.query<{
			space_key: string;
			permission: string;
			anonymous: boolean;
			username: string | null;
			group_name: string | null;
		}>(
			`
			select space.key as space_key, permission.permission, permission.anonymous,
			       subject.username, permission.group_name
			from space_permissions permission
			join spaces space on space.id = permission.space_id
			left join users subject on subject.id = permission.user_id
			${wikiFilter}
			`,
			wikiFilter ? spaceParams : [],
		);
		for (const row of rows.rows) {
			const subject = row.anonymous
				? "anonymous"
				: row.group_name
					? `group:${row.group_name}`
					: row.username
						? `user:${row.username}`
						: null;
			if (!subject) continue;
			const list = permissions.get(row.space_key) ?? [];
			list.push(`${row.permission}:${subject}`);
			permissions.set(row.space_key, list);
		}
	}

	const socialFilter =
		options.spaceKeys && options.spaceKeys.length > 0
			? "and space.key = any($1::text[])"
			: "";
	const pageWatchers = new Map<string, number>();
	if (tables.hasColumns("page_watchers", ["page_id", "source_id"])) {
		const rows = await pool.query<{ page_source_id: string; count: number }>(
			`
			select page.source_id as page_source_id, count(*)::int as count
			from page_watchers watcher
			join pages page on page.id = watcher.page_id
			join spaces space on space.id = page.space_id
			where watcher.source_id is not null ${socialFilter}
			group by page.source_id
			`,
			socialFilter ? spaceParams : [],
		);
		for (const row of rows.rows) {
			pageWatchers.set(row.page_source_id, row.count);
		}
	}

	const spaceWatchers = new Map<string, number>();
	if (tables.hasColumns("space_watchers", ["space_id", "source_id"])) {
		const rows = await pool.query<{ space_key: string; count: number }>(
			`
			select space.key as space_key, count(*)::int as count
			from space_watchers watcher
			join spaces space on space.id = watcher.space_id
			where watcher.source_id is not null ${socialFilter}
			group by space.key
			`,
			socialFilter ? spaceParams : [],
		);
		for (const row of rows.rows) {
			spaceWatchers.set(row.space_key, row.count);
		}
	}

	const pageLikes = new Map<string, number>();
	if (tables.hasColumns("page_likes", ["page_id", "source_id"])) {
		const rows = await pool.query<{ page_source_id: string; count: number }>(
			`
			select page.source_id as page_source_id, count(*)::int as count
			from page_likes likes
			join pages page on page.id = likes.page_id
			join spaces space on space.id = page.space_id
			where likes.source_id is not null ${socialFilter}
			group by page.source_id
			`,
			socialFilter ? spaceParams : [],
		);
		for (const row of rows.rows) {
			pageLikes.set(row.page_source_id, row.count);
		}
	}

	const tree = new Map<
		string,
		{ parentSourceId: string | null; position: number }
	>();
	for (const page of pages.values()) {
		if (page.status !== "current") continue;
		tree.set(page.sourceId, {
			parentSourceId: page.parentSourceId,
			position: page.position,
		});
	}

	return {
		spaces: spaces.rows.map((row) => ({
			key: row.key,
			sourceId: row.source_id,
			status: row.status,
		})),
		localPages,
		pages,
		versions,
		comments,
		attachments,
		labels,
		restrictions,
		permissions,
		tree,
		pageWatchers,
		spaceWatchers,
		pageLikes,
	};
}

export async function loadParityDatabase(
	pool: pg.Pool,
	options: { projectKeys?: string[]; spaceKeys?: string[] } = {},
): Promise<ParityDatabase> {
	const tables = await loadTableSet(pool);
	return {
		tables,
		jira: await loadJiraSnapshot(pool, tables, {
			projectKeys: options.projectKeys,
		}),
		wiki: await loadWikiSnapshot(pool, tables, {
			spaceKeys: options.spaceKeys,
		}),
	};
}
