import { sql } from "drizzle-orm";
import { z } from "zod";
import { JqlError, parseJql } from "../../shared/jql/index.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { loadCatalog } from "../jql/catalog.ts";
import { compileJql } from "../jql/compile.ts";
import { withStatementTimeout } from "../jql/timeout.ts";
import { viewerProjectIds } from "../permissions.ts";

export const MAX_RESULTS = 100;

export const issueParams = z.object({
	key: z.string().min(1).max(64),
});

export const searchQuery = z.object({
	jql: z.string().max(100_000).optional(),
	startAt: z.coerce.number().int().min(0).default(0),
	maxResults: z.coerce.number().int().min(1).max(MAX_RESULTS).default(50),
	fields: z.string().max(10_000).optional(),
});

/** Jira writes dates as 2026-01-01T10:00:00.000+0000. */
function jiraDate(value: Date | string | null | undefined) {
	if (!value) return null;
	const iso = (value instanceof Date ? value : new Date(value)).toISOString();
	return `${iso.slice(0, 19)}.${iso.slice(20, 23)}+0000`;
}

function statusCategory(category: string) {
	switch (category) {
		case "done":
			return { id: 3, key: "done", colorName: "green", name: "Done" };
		case "indeterminate":
			return {
				id: 4,
				key: "indeterminate",
				colorName: "yellow",
				name: "In Progress",
			};
		default:
			return { id: 2, key: "new", colorName: "blue-gray", name: "To Do" };
	}
}

type Row = Record<string, unknown>;

function userJson(
	base: string,
	id: unknown,
	username: unknown,
	displayName: unknown,
	email: unknown,
	active: unknown,
) {
	if (!id) return null;
	return {
		self: `${base}/rest/api/2/user?username=${encodeURIComponent(String(username))}`,
		key: String(id),
		name: String(username),
		emailAddress: email === null ? null : String(email),
		avatarUrls: {},
		displayName: String(displayName),
		active: active !== false,
	};
}

function issueJson(base: string, row: Row, showEmail: boolean) {
	const fields: Record<string, unknown> = {
		summary: String(row.summary),
		description:
			row.description_source === null ? null : String(row.description_source),
		issuetype: {
			self: `${base}/rest/api/2/issuetype/${row.type_id}`,
			id: String(row.type_id),
			name: String(row.type_name),
			subtask: Boolean(row.type_subtask),
		},
		status: {
			self: `${base}/rest/api/2/status/${row.status_id}`,
			id: String(row.status_id),
			name: String(row.status_name),
			statusCategory: statusCategory(String(row.status_category)),
		},
		priority: row.priority_id
			? { id: String(row.priority_id), name: String(row.priority_name) }
			: null,
		resolution: row.resolution_id
			? { id: String(row.resolution_id), name: String(row.resolution_name) }
			: null,
		assignee: userJson(
			base,
			row.assignee_id,
			row.assignee_username,
			row.assignee_display_name,
			showEmail ? row.assignee_email : null,
			row.assignee_active,
		),
		reporter: userJson(
			base,
			row.reporter_id,
			row.reporter_username,
			row.reporter_display_name,
			showEmail ? row.reporter_email : null,
			row.reporter_active,
		),
		creator: userJson(
			base,
			row.creator_id,
			row.creator_username,
			row.creator_display_name,
			showEmail ? row.creator_email : null,
			row.creator_active,
		),
		project: {
			self: `${base}/rest/api/2/project/${row.project_id}`,
			id: String(row.project_id),
			key: String(row.project_key),
			name: String(row.project_name),
		},
		created: jiraDate(row.created as string | null),
		updated: jiraDate(row.updated as string | null),
		resolutiondate: jiraDate(row.resolved as string | null),
		duedate: row.due_date === null ? null : String(row.due_date),
		labels: (row.labels as string[] | null) ?? [],
		components: ((row.components as string[] | null) ?? []).map((name) => ({
			name,
		})),
		fixVersions: ((row.fix_versions as string[] | null) ?? []).map((name) => ({
			name,
		})),
		versions: ((row.affects_versions as string[] | null) ?? []).map((name) => ({
			name,
		})),
		timespent: row.time_spent === null ? null : Number(row.time_spent),
		timeestimate:
			row.remaining_estimate === null ? null : Number(row.remaining_estimate),
		timeoriginalestimate:
			row.original_estimate === null ? null : Number(row.original_estimate),
		parent: row.parent_key === null ? null : { key: String(row.parent_key) },
		subtasks: [],
		issuelinks: [],
		attachment: [],
		comment: { comments: [], maxResults: 0, total: 0, startAt: 0 },
		worklog: { worklogs: [], maxResults: 0, total: 0, startAt: 0 },
	};

	return {
		expand:
			"renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
		id: String(row.source_id),
		self: `${base}/rest/api/2/issue/${row.source_id}`,
		key: String(row.key),
		fields,
	};
}

const SELECT_ISSUE = sql`
	select
		issues.id, issues.source_id, issues.key, issues.summary,
		issues.description_source, issues.created, issues.updated, issues.resolved,
		issues.due_date, issues.time_spent, issues.remaining_estimate,
		issues.original_estimate, issues.story_points,
		it.source_id as type_id, it.name as type_name, it.subtask as type_subtask,
		s.source_id as status_id, s.name as status_name, s.category as status_category,
		p.source_id as priority_id, p.name as priority_name,
		r.source_id as resolution_id, r.name as resolution_name,
		proj.source_id as project_id, proj.key as project_key, proj.name as project_name,
		a.id as assignee_id, a.username as assignee_username,
		a.display_name as assignee_display_name, a.email as assignee_email,
		a.active as assignee_active,
		rp.id as reporter_id, rp.username as reporter_username,
		rp.display_name as reporter_display_name, rp.email as reporter_email,
		rp.active as reporter_active,
		cr.id as creator_id, cr.username as creator_username,
		cr.display_name as creator_display_name, cr.email as creator_email,
		cr.active as creator_active,
		parent.key as parent_key,
		array(select il.label from issue_labels il where il.issue_id = issues.id order by il.label) as labels,
		array(select c.name from issue_components ic join components c on c.id = ic.component_id
			where ic.issue_id = issues.id order by c.name) as components,
		array(select v.name from issue_fix_versions fv join versions v on v.id = fv.version_id
			where fv.issue_id = issues.id order by v.name) as fix_versions,
		array(select v.name from issue_affects_versions av join versions v on v.id = av.version_id
			where av.issue_id = issues.id order by v.name) as affects_versions
	from issues
	join issue_types it on it.id = issues.type_id
	join statuses s on s.id = issues.status_id
	join projects proj on proj.id = issues.project_id
	left join priorities p on p.id = issues.priority_id
	left join resolutions r on r.id = issues.resolution_id
	left join users a on a.id = issues.assignee_id
	left join users rp on rp.id = issues.reporter_id
	left join users cr on cr.id = issues.creator_id
	left join issues parent on parent.id = issues.parent_id
`;

export async function compatIssue(
	actor: CurrentUser,
	key: string,
	base: string,
) {
	const result = await db.execute(sql`
		${SELECT_ISSUE}
		where upper(issues.key) = ${key.toUpperCase()}
			and issues.project_id = any(${sql.param(await viewerProjectIds(actor))}::uuid[])
		limit 1
	`);
	const row = (result.rows as Row[])[0];
	if (!row) {
		throw new HttpError(
			404,
			"Issue does not exist or you do not have permission to see it.",
		);
	}
	return issueJson(base, row, actor.isAdmin);
}

export async function compatSearch(
	actor: CurrentUser,
	input: z.output<typeof searchQuery>,
	base: string,
) {
	const jql = input.jql ?? "";
	let where = sql`true`;
	let orderBy = sql`issues.key desc`;
	try {
		const compiled = await compileJql(parseJql(jql), {
			user: actor,
			catalog: await loadCatalog(),
			visibleProjectIds: await viewerProjectIds(actor),
		});
		where = compiled.where ?? sql`true`;
		if (compiled.orderBy.length > 0) {
			orderBy = sql.join(compiled.orderBy, sql`, `);
		}
	} catch (error) {
		if (error instanceof JqlError) {
			throw new HttpError(400, error.jiraMessage);
		}
		throw error;
	}

	const { total, result } = await withStatementTimeout(async (tx) => {
		const totalResult = await tx.execute(
			sql`select count(*)::int as total from issues where ${where}`,
		);
		const result = await tx.execute(sql`
			${SELECT_ISSUE}
			where ${where}
			order by ${orderBy}
			limit ${input.maxResults} offset ${input.startAt}
		`);
		return {
			total: Number((totalResult.rows[0] as { total: number }).total),
			result,
		};
	});

	return {
		expand: "names,schema",
		startAt: input.startAt,
		maxResults: input.maxResults,
		total,
		issues: (result.rows as Row[]).map((row) =>
			issueJson(base, row, actor.isAdmin),
		),
	};
}
