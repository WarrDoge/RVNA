import { sql } from "drizzle-orm";
import { JqlError, parseJql } from "../../shared/jql/index.ts";
import type { CurrentUser } from "../auth.ts";
import { HttpError } from "../http.ts";
import { loadCatalog } from "../jql/catalog.ts";
import { compileJql, type SearchUser } from "../jql/compile.ts";
import { withStatementTimeout } from "../jql/timeout.ts";
import { viewerProjectIds } from "../permissions.ts";

export interface SearchRequest {
	jql: string;
	startAt: number;
	maxResults: number;
}

export interface SearchIssue {
	key: string;
	summary: string;
	type: string;
	status: string;
	priority: string | null;
	assignee: { username: string; displayName: string } | null;
	reporter: { username: string; displayName: string } | null;
	resolution: string | null;
	created: string | null;
	updated: string | null;
	storyPoints: number | null;
	labels: string[];
}

export interface SearchResult {
	startAt: number;
	maxResults: number;
	total: number;
	issues: SearchIssue[];
}

export const DEFAULT_MAX_RESULTS = 50;
export const MAX_RESULTS_LIMIT = 100;

export async function searchIssues(
	request: SearchRequest,
	user: SearchUser | null,
	options: { now?: Date; timeZone?: string } = {},
): Promise<SearchResult> {
	const maxResults = Math.min(
		MAX_RESULTS_LIMIT,
		Math.max(1, request.maxResults || DEFAULT_MAX_RESULTS),
	);
	const startAt = Math.max(0, request.startAt || 0);
	const query = parseJql(request.jql);
	const visible = user ? await viewerProjectIds(user) : [];
	const compiled = await compileJql(query, {
		user,
		now: options.now,
		timeZone: options.timeZone,
		catalog: await loadCatalog(),
		visibleProjectIds: visible,
	});

	const where = compiled.where ?? sql`true`;
	const orderBy = sql.join(compiled.orderBy, sql`, `);

	const { total, result } = await withStatementTimeout(async (tx) => {
		const totalResult = await tx.execute(
			sql`select count(*)::int as total from issues where ${where}`,
		);
		const total = Number((totalResult.rows[0] as { total: number }).total);

		const result = await tx.execute(sql`
			select
				issues.key,
				issues.summary,
				it.name as type,
				s.name as status,
				p.name as priority,
				a.username as assignee_username,
				a.display_name as assignee_display_name,
				rp.username as reporter_username,
				rp.display_name as reporter_display_name,
				res.name as resolution,
				issues.created,
				issues.updated,
				issues.story_points,
				array(
					select il.label from issue_labels il
					where il.issue_id = issues.id order by il.label
				) as labels
			from issues
			join issue_types it on it.id = issues.type_id
			join statuses s on s.id = issues.status_id
			left join priorities p on p.id = issues.priority_id
			left join users a on a.id = issues.assignee_id
			left join users rp on rp.id = issues.reporter_id
			left join resolutions res on res.id = issues.resolution_id
			where ${where}
			order by ${orderBy}
			limit ${maxResults} offset ${startAt}
		`);
		return { total, result };
	});

	const issues = (result.rows as Record<string, unknown>[]).map((row) => ({
		key: String(row.key),
		summary: String(row.summary),
		type: String(row.type),
		status: String(row.status),
		priority: row.priority === null ? null : String(row.priority),
		assignee:
			row.assignee_username === null
				? null
				: {
						username: String(row.assignee_username),
						displayName: String(row.assignee_display_name),
					},
		reporter:
			row.reporter_username === null
				? null
				: {
						username: String(row.reporter_username),
						displayName: String(row.reporter_display_name),
					},
		resolution: row.resolution === null ? null : String(row.resolution),
		created:
			row.created === null
				? null
				: new Date(row.created as string).toISOString(),
		updated:
			row.updated === null
				? null
				: new Date(row.updated as string).toISOString(),
		storyPoints: row.story_points === null ? null : Number(row.story_points),
		labels: (row.labels as string[] | null) ?? [],
	}));

	return { startAt, maxResults, total, issues };
}

/** Search for a signed-in user, with JQL failures as the endpoint's 400. */
export async function search(
	actor: CurrentUser,
	request: SearchRequest,
	options: { now?: Date; timeZone?: string } = {},
): Promise<SearchResult> {
	try {
		return await searchIssues(request, actor, options);
	} catch (error) {
		if (error instanceof JqlError) throw new HttpError(400, error.jiraMessage);
		throw error;
	}
}
