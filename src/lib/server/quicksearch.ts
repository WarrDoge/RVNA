import { sql } from "drizzle-orm";
import { z } from "zod";
import { issueTypeRefSchema, statusRefSchema } from "./api-schemas.ts";
import type { CurrentUser } from "./auth.ts";
import { db } from "./db.ts";
import { viewerProjectIds } from "./permissions.ts";
import { searchPages } from "./search-pages.ts";
import {
	agentProjectIds,
	readableCommentCondition,
} from "./servicedesk/access.ts";

const ISSUE_LIMIT = 6;
const PROJECT_LIMIT = 5;
const PAGE_LIMIT = 3;

function likePattern(value: string) {
	return value.replace(/[!%_\\]/g, (character) => `!${character}`);
}

export const quickSearchResponseSchema = z.object({
	issues: z.array(
		z.object({
			id: z.uuid(),
			key: z.string(),
			summary: z.string(),
			type: issueTypeRefSchema,
			status: statusRefSchema,
		}),
	),
	projects: z.array(
		z.object({
			key: z.string(),
			name: z.string(),
			avatarUrl: z.string().nullable(),
		}),
	),
	pages: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			spaceKey: z.string(),
			spaceName: z.string(),
		}),
	),
});

export type QuickSearchResult = z.infer<typeof quickSearchResponseSchema>;

export async function quickSearch(
	user: CurrentUser,
	query: string,
): Promise<QuickSearchResult> {
	if (query === "") return { issues: [], projects: [], pages: [] };

	const pattern = likePattern(query);
	const prefix = `${pattern}%`;
	const contains = `%${pattern}%`;
	const visible = await viewerProjectIds(user);
	const agentProjects = await agentProjectIds(user);

	const issueRows = await db.execute(sql`
		select
			issues.id,
			issues.key,
			issues.summary,
			it.id as type_id,
			it.name as type_name,
			it.subtask as type_subtask,
			s.id as status_id,
			s.name as status_name,
			s.category as status_category
		from issues
		join issue_types it on it.id = issues.type_id
		join statuses s on s.id = issues.status_id
		where
			issues.project_id = any(${sql.param(visible)}::uuid[])
			and (
				issues.key ilike ${prefix} escape '!'
				or issues.summary ilike ${contains} escape '!'
				or issues.description_source ilike ${contains} escape '!'
				or exists (
					select 1 from comments c
					where c.issue_id = issues.id
						and ${readableCommentCondition(sql`c.internal`, sql`issues.project_id`, agentProjects)}
						and c.body_source ilike ${contains} escape '!'
				)
			)
		order by
			case
				when upper(issues.key) = upper(${query}) then 0
				when issues.key ilike ${prefix} escape '!' then 1
				when issues.summary ilike ${contains} escape '!' then 2
				else 3
			end,
			issues.updated desc nulls last,
			issues.key
		limit ${ISSUE_LIMIT}
	`);

	const projectRows = await db.execute(sql`
		select
			projects.key,
			projects.name,
			'/api/avatars/projects/' || projects.id::text as avatar_url
		from projects
		where
			projects.archived = false
			and projects.id = any(${sql.param(visible)}::uuid[])
			and (
				projects.key ilike ${prefix} escape '!'
				or projects.name ilike ${contains} escape '!'
			)
		order by
			case
				when upper(projects.key) = upper(${query}) then 0
				when projects.key ilike ${prefix} escape '!' then 1
				else 2
			end,
			projects.name
		limit ${PROJECT_LIMIT}
	`);

	return {
		issues: (issueRows.rows as Record<string, unknown>[]).map((row) => ({
			id: String(row.id),
			key: String(row.key),
			summary: String(row.summary),
			type: {
				id: String(row.type_id),
				name: String(row.type_name),
				subtask: Boolean(row.type_subtask),
			},
			status: {
				id: String(row.status_id),
				name: String(row.status_name),
				category: String(row.status_category) as
					| "new"
					| "indeterminate"
					| "done",
			},
		})),
		projects: (projectRows.rows as Record<string, unknown>[]).map((row) => ({
			key: String(row.key),
			name: String(row.name),
			avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
		})),
		pages: (await searchPages(user, query, PAGE_LIMIT)).pages.map((page) => ({
			id: page.id,
			title: page.title,
			spaceKey: page.spaceKey,
			spaceName: page.spaceName,
		})),
	};
}
