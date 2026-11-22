import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	customFieldId as customFieldSourceId,
	resolveCustomFieldRoles,
} from "../../shared/custom-field-roles.ts";
import {
	customFieldId,
	customFieldJql,
	customSourceId,
	isCustomColumn,
	normalizeColumns,
	systemField,
	visibleColumns,
} from "../../shared/fields.ts";
import { JqlError, parseJql } from "../../shared/jql/index.ts";
import {
	issueTypeRefSchema,
	priorityRefSchema,
	resolutionRefSchema,
	statusRefSchema,
	userRefSchema,
} from "../api-schemas.ts";
import type { CurrentUser } from "../auth.ts";
import { formatCustomValue, isVisibleCustomField } from "../custom-fields.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { loadCatalog } from "../jql/catalog.ts";
import { compileJql, type SearchUser } from "../jql/compile.ts";
import { withStatementTimeout } from "../jql/timeout.ts";
import { viewerProjectIds, visibleProjectIds } from "../permissions.ts";
import { fields, issueViews, userPreferences } from "../schema.ts";

export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 100;
const EXPORT_LIMIT = 1000;
const EXPORT_CHUNK = 500;

export const navigatorIssueSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	summary: z.string(),
	type: issueTypeRefSchema,
	status: statusRefSchema,
	priority: priorityRefSchema.nullable(),
	resolution: resolutionRefSchema.nullable(),
	assignee: userRefSchema.nullable(),
	reporter: userRefSchema.nullable(),
	creator: userRefSchema.nullable(),
	project: z.object({ key: z.string(), name: z.string() }),
	created: z.iso.datetime().nullable(),
	updated: z.iso.datetime().nullable(),
	resolved: z.iso.datetime().nullable(),
	dueDate: z.string().nullable(),
	labels: z.array(z.string()),
	components: z.array(z.string()),
	fixVersions: z.array(z.string()),
	affectsVersions: z.array(z.string()),
	sprint: z.string().nullable(),
	epic: z.object({ key: z.string(), summary: z.string() }).nullable(),
	parent: z.object({ key: z.string(), summary: z.string() }).nullable(),
	storyPoints: z.number().nullable(),
	timeSpent: z.number().int().nullable(),
	originalEstimate: z.number().int().nullable(),
	remainingEstimate: z.number().int().nullable(),
	custom: z.record(z.string(), z.string()),
});

export type NavigatorIssue = z.infer<typeof navigatorIssueSchema>;

export const navigatorPageSchema = z.object({
	startAt: z.number().int(),
	maxResults: z.number().int(),
	total: z.number().int(),
	issues: z.array(navigatorIssueSchema),
});

export interface NavigatorRequest {
	jql: string;
	startAt: number;
	maxResults: number;
	columns: string[];
}

export function columnList(value: string | undefined) {
	if (!value) return normalizeColumns(undefined);
	return normalizeColumns(value.split(","));
}

function sprintSourceId(catalog: Awaited<ReturnType<typeof loadCatalog>>) {
	return customFieldSourceId(
		resolveCustomFieldRoles(catalog.customFields),
		"sprint",
	);
}

function customProjection(columns: string[]) {
	const keys = columns.filter(isCustomColumn).map(customSourceId);
	if (keys.length === 0) return sql`'{}'::jsonb`;
	return sql`jsonb_build_object(${sql.join(
		keys.flatMap((key) => [
			sql`${key}::text`,
			sql`issues.custom->(${key}::text)`,
		]),
		sql`, `,
	)})`;
}

function sprintProjection(sourceId: string | null) {
	if (!sourceId) return sql<string | null>`null`;
	return sql<string | null>`(
		select substring(value from 'name=(.*?)(?:,[A-Za-z]+=|\\])')
		from jsonb_array_elements_text(coalesce(issues.custom->(${sourceId}::text), '[]'::jsonb)) as value
		limit 1
	)`;
}

function assertVisibleColumns(
	columns: string[],
	catalog: Awaited<ReturnType<typeof loadCatalog>>,
) {
	const visible = new Set(
		catalog.customFields
			.filter(isVisibleCustomField)
			.map((field) => field.sourceId),
	);
	for (const column of columns) {
		if (!isCustomColumn(column)) continue;
		if (!visible.has(customSourceId(column))) {
			throw new JqlError(
				`Column '${column}' does not exist or you do not have permission to view it.`,
			);
		}
	}
}

export async function loadNavigatorPage(
	request: NavigatorRequest,
	user: SearchUser | null,
): Promise<{
	startAt: number;
	maxResults: number;
	total: number;
	issues: NavigatorIssue[];
}> {
	const columns = normalizeColumns(request.columns);
	const maxResults = Math.min(MAX_PAGE, Math.max(1, request.maxResults));
	const startAt = Math.max(0, request.startAt);
	const catalog = await loadCatalog();
	assertVisibleColumns(columns, catalog);
	const visible = user ? await viewerProjectIds(user) : [];
	const compiled = await compileJql(parseJql(request.jql), {
		user,
		catalog,
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
				issues.id,
				issues.key,
				issues.summary,
				it.id as type_id,
				it.name as type_name,
				it.subtask as type_subtask,
				case when it.icon_file is null or it.icon_url like 'builtin:%' then it.icon_url else '/api/avatars/issuetypes/' || it.id::text end as type_icon_url,
				s.id as status_id,
				s.name as status_name,
				s.category as status_category,
				p.id as priority_id,
				p.name as priority_name,
				p.icon_color as priority_color,
				case when p.icon_file is null then null else '/api/avatars/priorities/' || p.id::text end as priority_icon_url,
				r.id as resolution_id,
				r.name as resolution_name,
				a.id as assignee_id,
				a.username as assignee_username,
				a.display_name as assignee_display_name,
				case when a.id is null then null else '/api/avatars/users/' || a.id::text end as assignee_avatar_url,
				rp.id as reporter_id,
				rp.username as reporter_username,
				rp.display_name as reporter_display_name,
				case when rp.id is null then null else '/api/avatars/users/' || rp.id::text end as reporter_avatar_url,
				cr.id as creator_id,
				cr.username as creator_username,
				cr.display_name as creator_display_name,
				case when cr.id is null then null else '/api/avatars/users/' || cr.id::text end as creator_avatar_url,
				proj.key as project_key,
				proj.name as project_name,
				issues.created,
				issues.updated,
				issues.resolved,
				issues.due_date,
				issues.story_points,
				issues.time_spent,
				issues.original_estimate,
				issues.remaining_estimate,
				epic.key as epic_key,
				epic.summary as epic_summary,
				parent.key as parent_key,
				parent.summary as parent_summary,
				array(
					select il.label from issue_labels il
					where il.issue_id = issues.id order by il.label
				) as labels,
				array(
					select c.name from issue_components ic
					join components c on c.id = ic.component_id
					where ic.issue_id = issues.id order by c.name
				) as components,
				array(
					select v.name from issue_fix_versions fv
					join versions v on v.id = fv.version_id
					where fv.issue_id = issues.id order by v.name
				) as fix_versions,
				array(
					select v.name from issue_affects_versions av
					join versions v on v.id = av.version_id
					where av.issue_id = issues.id order by v.name
				) as affects_versions,
				${sprintProjection(sprintSourceId(catalog))} as sprint,
				${customProjection(columns)} as custom
			from issues
			join issue_types it on it.id = issues.type_id
			join statuses s on s.id = issues.status_id
			join projects proj on proj.id = issues.project_id
			left join priorities p on p.id = issues.priority_id
			left join resolutions r on r.id = issues.resolution_id
			left join users a on a.id = issues.assignee_id
			left join users rp on rp.id = issues.reporter_id
			left join users cr on cr.id = issues.creator_id
			left join issues epic on epic.id = issues.epic_id
				and epic.project_id = any(${sql.param(visible)}::uuid[])
			left join issues parent on parent.id = issues.parent_id
				and parent.project_id = any(${sql.param(visible)}::uuid[])
			where ${where}
			order by ${orderBy}
			limit ${maxResults} offset ${startAt}
		`);
		return { total, result };
	});

	const issuesPage = (result.rows as Record<string, unknown>[]).map((row) =>
		mapRow(row, columns),
	);

	return { startAt, maxResults, total, issues: issuesPage };
}

/** Navigator page for a signed-in user, with JQL failures as the endpoint's 400. */
export async function navigatorPage(
	actor: CurrentUser,
	request: NavigatorRequest,
): Promise<Awaited<ReturnType<typeof loadNavigatorPage>>> {
	try {
		return await loadNavigatorPage(request, actor);
	} catch (error) {
		if (error instanceof JqlError) throw new HttpError(400, error.jiraMessage);
		throw error;
	}
}

function iso(value: unknown) {
	if (value === null || value === undefined) return null;
	return new Date(value as string).toISOString();
}

function userRef(
	id: unknown,
	username: unknown,
	displayName: unknown,
	avatarUrl: unknown,
) {
	if (!id || !username || !displayName) return null;
	return {
		id: String(id),
		username: String(username),
		displayName: String(displayName),
		avatarUrl: avatarUrl === null ? null : String(avatarUrl),
	};
}

function strings(value: unknown) {
	return Array.isArray(value) ? value.map(String) : [];
}

function mapRow(
	row: Record<string, unknown>,
	columns: string[],
): NavigatorIssue {
	const custom = (row.custom as Record<string, unknown> | null) ?? {};
	const customValues: Record<string, string> = {};
	for (const column of columns) {
		if (!isCustomColumn(column)) continue;
		const sourceId = customSourceId(column);
		customValues[sourceId] = formatCustomValue(custom[sourceId]);
	}

	return {
		id: String(row.id),
		key: String(row.key),
		summary: String(row.summary),
		type: {
			id: String(row.type_id),
			name: String(row.type_name),
			subtask: Boolean(row.type_subtask),
			iconUrl: row.type_icon_url === null ? null : String(row.type_icon_url),
		},
		status: {
			id: String(row.status_id),
			name: String(row.status_name),
			category: String(row.status_category) as "new" | "indeterminate" | "done",
		},
		priority: row.priority_id
			? {
					id: String(row.priority_id),
					name: String(row.priority_name),
					iconColor:
						row.priority_color === null ? null : String(row.priority_color),
					iconUrl:
						row.priority_icon_url === null
							? null
							: String(row.priority_icon_url),
				}
			: null,
		resolution: row.resolution_id
			? { id: String(row.resolution_id), name: String(row.resolution_name) }
			: null,
		assignee: userRef(
			row.assignee_id,
			row.assignee_username,
			row.assignee_display_name,
			row.assignee_avatar_url,
		),
		reporter: userRef(
			row.reporter_id,
			row.reporter_username,
			row.reporter_display_name,
			row.reporter_avatar_url,
		),
		creator: userRef(
			row.creator_id,
			row.creator_username,
			row.creator_display_name,
			row.creator_avatar_url,
		),
		project: { key: String(row.project_key), name: String(row.project_name) },
		created: iso(row.created),
		updated: iso(row.updated),
		resolved: iso(row.resolved),
		dueDate: row.due_date === null ? null : String(row.due_date),
		labels: strings(row.labels),
		components: strings(row.components),
		fixVersions: strings(row.fix_versions),
		affectsVersions: strings(row.affects_versions),
		sprint: row.sprint === null ? null : String(row.sprint),
		epic:
			row.epic_key === null
				? null
				: { key: String(row.epic_key), summary: String(row.epic_summary) },
		parent:
			row.parent_key === null
				? null
				: { key: String(row.parent_key), summary: String(row.parent_summary) },
		storyPoints: row.story_points === null ? null : Number(row.story_points),
		timeSpent: row.time_spent === null ? null : Number(row.time_spent),
		originalEstimate:
			row.original_estimate === null ? null : Number(row.original_estimate),
		remainingEstimate:
			row.remaining_estimate === null ? null : Number(row.remaining_estimate),
		custom: customValues,
	};
}

function formatSeconds(seconds: number | null) {
	if (seconds === null) return "";
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
	if (hours > 0) return `${hours}h`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
}

function cellText(issue: NavigatorIssue, column: string): string {
	if (isCustomColumn(column)) {
		return issue.custom[customSourceId(column)] ?? "";
	}
	switch (column) {
		case "type":
			return issue.type.name;
		case "key":
			return issue.key;
		case "summary":
			return issue.summary;
		case "assignee":
			return issue.assignee?.displayName ?? "";
		case "reporter":
			return issue.reporter?.displayName ?? "";
		case "creator":
			return issue.creator?.displayName ?? "";
		case "priority":
			return issue.priority?.name ?? "";
		case "status":
			return issue.status.name;
		case "resolution":
			return issue.resolution?.name ?? "";
		case "created":
			return issue.created ?? "";
		case "updated":
			return issue.updated ?? "";
		case "resolved":
			return issue.resolved ?? "";
		case "dueDate":
			return issue.dueDate ?? "";
		case "labels":
			return issue.labels.join(", ");
		case "components":
			return issue.components.join(", ");
		case "fixVersions":
			return issue.fixVersions.join(", ");
		case "affectsVersions":
			return issue.affectsVersions.join(", ");
		case "sprint":
			return issue.sprint ?? "";
		case "epic":
			return issue.epic?.key ?? "";
		case "parent":
			return issue.parent?.key ?? "";
		case "project":
			return issue.project.name;
		case "storyPoints":
			return issue.storyPoints === null ? "" : String(issue.storyPoints);
		case "timeSpent":
			return formatSeconds(issue.timeSpent);
		case "originalEstimate":
			return formatSeconds(issue.originalEstimate);
		case "remainingEstimate":
			return formatSeconds(issue.remainingEstimate);
		default: {
			const field = systemField(column);
			return field ? "" : "";
		}
	}
}

/**
 * Excel and Sheets run a cell that starts with one of these characters, so a
 * summary like `=HYPERLINK(...)` would become a formula.
 */
export function csvCell(value: string) {
	let text = value;
	if (/^[=+\-@]/.test(text)) text = `'${text}`;
	if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
	return text;
}

export function csvLine(values: string[]) {
	return `${values.map(csvCell).join(",")}\r\n`;
}

async function customFieldNames() {
	const rows = await withStatementTimeout(async (tx) =>
		tx.select().from(fields),
	);
	const names = new Map<string, string>();
	for (const row of rows) {
		if (isVisibleCustomField(row)) names.set(row.sourceId, row.name);
	}
	return names;
}

function headerName(column: string, customNames: Map<string, string>) {
	if (isCustomColumn(column)) {
		return customNames.get(customSourceId(column)) ?? customSourceId(column);
	}
	return systemField(column)?.name ?? column;
}

export async function* exportCsv(
	request: { jql: string; columns: string[] },
	user: SearchUser | null,
) {
	const columns = normalizeColumns(request.columns);
	const customNames = await customFieldNames();
	yield csvLine(columns.map((column) => headerName(column, customNames)));

	let written = 0;
	while (written < EXPORT_LIMIT) {
		const page = await loadNavigatorPage(
			{
				jql: request.jql,
				startAt: written,
				maxResults: Math.min(EXPORT_CHUNK, EXPORT_LIMIT - written),
				columns,
			},
			user,
		);
		if (page.issues.length === 0) return;
		for (const issue of page.issues) {
			yield csvLine(columns.map((column) => cellText(issue, column)));
		}
		written += page.issues.length;
		if (written >= page.total) return;
	}
}

/** Validate the query before a download starts, so a bad JQL is a JSON 400. */
export async function prepareExport(
	actor: CurrentUser,
	request: { jql: string; columns: string[] },
) {
	try {
		const catalog = await loadCatalog();
		const parsed = parseJql(request.jql);
		assertVisibleColumns(request.columns, catalog);
		await compileJql(parsed, {
			user: actor,
			catalog,
			visibleProjectIds: await viewerProjectIds(actor),
		});
	} catch (error) {
		if (error instanceof JqlError) throw new HttpError(400, error.jiraMessage);
		throw error;
	}
}

export function safeFileName(value: string | undefined) {
	const base = [...(value ?? "search")]
		.map((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 || '/\\"'.includes(character)
				? "_"
				: character;
		})
		.join("")
		.trim()
		.slice(0, 100);
	return `${base === "" ? "search" : base}.csv`;
}

export const recentSchema = z.object({
	issues: z.array(
		z.object({
			id: z.uuid(),
			key: z.string(),
			summary: z.string(),
			type: issueTypeRefSchema,
			status: statusRefSchema,
			viewedAt: z.iso.datetime(),
		}),
	),
});

export async function recordIssueView(actor: CurrentUser, issueId: string) {
	await db
		.insert(issueViews)
		.values({ userId: actor.id, issueId, viewedAt: new Date() })
		.onConflictDoUpdate({
			target: [issueViews.userId, issueViews.issueId],
			set: { viewedAt: new Date() },
		});
}

export async function issueFields(_actor: CurrentUser) {
	const rows = await db.select().from(fields);
	return rows
		.filter(isVisibleCustomField)
		.map((row) => ({
			id: customFieldId(row.sourceId),
			name: row.name,
			jql: customFieldJql(row.sourceId, row.name),
			kind: customFieldKind(row.type),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export const fieldsSchema = z.array(
	z.object({
		id: z.string(),
		name: z.string(),
		jql: z.string(),
		kind: z.enum(["text", "number", "date", "datetime", "list"]),
	}),
);

export async function recentIssues(actor: CurrentUser, limit: number) {
	const capped = Math.min(
		50,
		Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 5),
	);
	const visible = await visibleProjectIds({
		...actor,
		groups: actor.groups ?? [],
		isAdmin: actor.isAdmin ?? false,
	});
	const rows = await db.execute(sql`
		select
			issues.id,
			issues.key,
			issues.summary,
			it.id as type_id,
			it.name as type_name,
			it.subtask as type_subtask,
			s.id as status_id,
			s.name as status_name,
			s.category as status_category,
			issue_views.viewed_at
		from issue_views
		join issues on issues.id = issue_views.issue_id
		join issue_types it on it.id = issues.type_id
		join statuses s on s.id = issues.status_id
		where issue_views.user_id = ${actor.id}
			and issues.project_id = any(${sql.param(visible)}::uuid[])
		order by issue_views.viewed_at desc
		limit ${capped}
	`);

	return {
		issues: (rows.rows as Record<string, unknown>[]).map((row) => ({
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
			viewedAt: new Date(row.viewed_at as string).toISOString(),
		})),
	};
}

export const navigatorPreferencesSchema = z.object({
	view: z.enum(["list", "detail"]),
	columns: z.array(z.string()),
});

export async function getNavigatorPreferences(actor: CurrentUser) {
	const [row] = await db
		.select()
		.from(userPreferences)
		.where(eq(userPreferences.userId, actor.id))
		.limit(1);

	return {
		view: row?.navigatorView ?? "list",
		columns: visibleColumns(row?.columns, await issueFields(actor)),
	};
}

export async function saveNavigatorPreferences(
	actor: CurrentUser,
	input: {
		view?: "list" | "detail";
		columns?: string[];
	},
) {
	const fields = await issueFields(actor);
	const columns =
		input.columns === undefined
			? undefined
			: visibleColumns(input.columns, fields);
	const [row] = await db
		.insert(userPreferences)
		.values({
			userId: actor.id,
			navigatorView: input.view ?? "list",
			columns: columns ?? normalizeColumns(undefined),
		})
		.onConflictDoUpdate({
			target: userPreferences.userId,
			set: {
				...(input.view !== undefined ? { navigatorView: input.view } : {}),
				...(columns !== undefined ? { columns } : {}),
				updatedAt: new Date(),
			},
		})
		.returning();

	return {
		view: row.navigatorView,
		columns: visibleColumns(row.columns, fields),
	};
}

function customFieldKind(type: string | null) {
	if (type === "number") return "number" as const;
	if (type === "date") return "date" as const;
	if (type === "datetime") return "datetime" as const;
	if (type === "array") return "list" as const;
	return "text" as const;
}
