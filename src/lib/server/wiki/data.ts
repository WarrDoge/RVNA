import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { JqlError, parseJql } from "../../shared/jql/index.ts";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import { loadCatalog } from "../jql/catalog.ts";
import { compileJql, type SearchUser } from "../jql/compile.ts";
import { withStatementTimeout } from "../jql/timeout.ts";
import { viewerProjectIds } from "../permissions.ts";
import {
	issues,
	issueTypes,
	pageAttachments,
	pageLabels,
	pages,
	pageVersions,
	priorities,
	resolutions,
	spaces,
	statuses,
	users,
} from "../schema.ts";
import type { WikiAccess } from "./permissions.ts";
import { findMacros, stripTags } from "./storage.ts";

export type PageLink = {
	id: string;
	sourceId: string;
	title: string;
	spaceKey: string;
	spaceName: string;
	updated: string | null;
	author: string | null;
	level?: number;
};

export type AttachmentRow = {
	id: string;
	pageId: string;
	fileName: string;
	mimeType: string | null;
	size: number;
	version: number;
	authorId: string | null;
	author: string | null;
	authorUsername: string | null;
	authorAvatarUrl: string | null;
	created: string | null;
	comment: string | null;
	sha256: string;
};

export function pageUrl(sourceId: string) {
	return `/pages/viewpage.action?pageId=${sourceId}`;
}

export function spaceUrl(key: string) {
	return `/display/${encodeURIComponent(key)}`;
}

function pageLinkSelect() {
	return {
		id: pages.id,
		sourceId: pages.sourceId,
		title: pages.title,
		spaceKey: spaces.key,
		spaceName: spaces.name,
		updated: pages.updated,
		author: users.displayName,
	};
}

type PageLinkRow = {
	id: string;
	sourceId: string;
	title: string;
	spaceKey: string;
	spaceName: string;
	updated: Date | string | null;
	author: string | null;
	level?: number;
};

function toPageLink(row: PageLinkRow): PageLink {
	return {
		id: row.id,
		sourceId: row.sourceId,
		title: row.title,
		spaceKey: row.spaceKey,
		spaceName: row.spaceName,
		updated: row.updated ? new Date(row.updated).toISOString() : null,
		author: row.author,
		level: row.level,
	};
}

function readablePages(access: WikiAccess) {
	const spaceIds = [...access.readableSpaceIds];
	const filters = [
		spaceIds.length > 0 ? inArray(pages.spaceId, spaceIds) : sql`false`,
	];
	if (access.hiddenPageIds.size > 0) {
		filters.push(notInArray(pages.id, [...access.hiddenPageIds]));
	}
	return and(...filters);
}

export function visiblePages(access: WikiAccess) {
	return and(readablePages(access), eq(pages.status, "current"));
}

function visibleRaw(access: WikiAccess, alias = "p") {
	const ids = [...access.readableSpaceIds];
	const table = sql.raw(alias);
	const readable =
		ids.length > 0
			? sql`${table}.space_id in (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `,
				)})`
			: sql`false`;
	if (access.hiddenPageIds.size === 0) return readable;
	const hidden = sql.join(
		[...access.hiddenPageIds].map((id) => sql`${id}`),
		sql`, `,
	);
	return sql`${readable} and ${table}.id not in (${hidden})`;
}

export async function childPageLinks(
	access: WikiAccess,
	parentId: string,
	options: {
		depth?: number;
		sort?: string;
		limit?: number;
		reverse?: boolean;
	} = {},
): Promise<PageLink[]> {
	const depth = Math.min(Math.max(options.depth ?? 1, 1), 10);
	const direction = options.reverse ? sql`desc` : sql`asc`;
	const order =
		options.sort === "title"
			? sql`lower(p.title) ${direction}`
			: options.sort === "creation"
				? sql`p.created ${direction} nulls last`
				: options.sort === "modified"
					? sql`p.updated ${direction} nulls last`
					: sql`p.position ${direction}, lower(p.title) ${direction}`;

	const rows = await db.execute(sql`
		with recursive descendants as (
			select p.id, p.parent_id, 1 as level
			from pages p
			where p.parent_id = ${parentId}
			union all
			select p.id, p.parent_id, d.level + 1
			from pages p
			join descendants d on p.parent_id = d.id
			where d.level < ${depth}
		)
		select p.id, p.source_id as "sourceId", p.title, s.key as "spaceKey",
			s.name as "spaceName", p.updated, u.display_name as author, d.level
		from descendants d
		join pages p on p.id = d.id
		join spaces s on s.id = p.space_id
		left join users u on u.id = p.last_modifier_id
		where p.status = 'current' and ${visibleRaw(access)}
		order by d.level, ${order}
		limit ${options.limit ?? 500}
	`);
	return (rows.rows as PageLinkRow[]).map(toPageLink);
}

export async function recentPageLinks(
	access: WikiAccess,
	spaceIds: string[],
	options: { limit?: number; type?: "page" | "blogpost" } = {},
): Promise<PageLink[]> {
	if (spaceIds.length === 0) return [];
	const filters = [visiblePages(access), inArray(pages.spaceId, spaceIds)];
	if (options.type) filters.push(eq(pages.type, options.type));
	const rows = await db
		.select(pageLinkSelect())
		.from(pages)
		.innerJoin(spaces, eq(spaces.id, pages.spaceId))
		.leftJoin(users, eq(users.id, pages.lastModifierId))
		.where(and(...filters))
		.orderBy(desc(pages.updated))
		.limit(Math.min(Math.max(options.limit ?? 10, 1), 100));
	return rows.map(toPageLink);
}

export async function pagesWithLabels(
	access: WikiAccess,
	labels: string[],
	spaceIds: string[],
	options: { limit?: number; matchAll?: boolean } = {},
): Promise<PageLink[]> {
	const wanted = [
		...new Set(
			labels
				.map((label) => label.trim().toLowerCase())
				.filter((label) => label !== ""),
		),
	];
	if (wanted.length === 0 || spaceIds.length === 0) return [];
	const filters = [visiblePages(access), inArray(pages.spaceId, spaceIds)];
	const rows = await db
		.select({
			...pageLinkSelect(),
			matches: sql<number>`count(distinct ${pageLabels.label})`,
		})
		.from(pages)
		.innerJoin(spaces, eq(spaces.id, pages.spaceId))
		.innerJoin(pageLabels, eq(pageLabels.pageId, pages.id))
		.leftJoin(users, eq(users.id, pages.lastModifierId))
		.where(and(...filters, inArray(pageLabels.label, wanted)))
		.groupBy(pages.id, spaces.key, spaces.name, users.displayName)
		.having(
			options.matchAll
				? sql`count(distinct ${pageLabels.label}) = ${wanted.length}`
				: sql`count(distinct ${pageLabels.label}) > 0`,
		)
		.orderBy(desc(pages.updated))
		.limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
	return rows.map(toPageLink);
}

export type PopularLabel = {
	label: string;
	count: number;
};

/** Labels on readable pages, most used first. */
export async function popularLabels(
	access: WikiAccess,
	spaceIds: string[],
	limit = 100,
): Promise<PopularLabel[]> {
	if (spaceIds.length === 0) return [];
	const rows = await db
		.select({
			label: pageLabels.label,
			count: sql<number>`count(*)::int`,
		})
		.from(pageLabels)
		.innerJoin(pages, eq(pages.id, pageLabels.pageId))
		.where(and(visiblePages(access), inArray(pages.spaceId, spaceIds)))
		.groupBy(pageLabels.label)
		.orderBy(sql`count(*) desc`, sql`lower(${pageLabels.label})`)
		.limit(Math.min(Math.max(limit, 1), 500));
	return rows.map((row) => ({ label: row.label, count: Number(row.count) }));
}

export type Contributor = {
	id: string | null;
	username: string | null;
	displayName: string;
	avatarUrl: string | null;
	count: number;
	lastUpdate: string | null;
};

export async function pageContributors(
	access: WikiAccess,
	pageId: string,
	options: { limit?: number; order?: string } = {},
): Promise<Contributor[]> {
	const order =
		options.order === "name"
			? sql`lower(${users.displayName})`
			: sql`max(${pageVersions.created}) desc nulls last`;
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarUrl: userAvatarSql(users.id),
			count: sql<number>`count(*)::int`,
			lastUpdate: sql<Date | null>`max(${pageVersions.created})`,
		})
		.from(pageVersions)
		.innerJoin(users, eq(users.id, pageVersions.authorId))
		.innerJoin(pages, eq(pages.id, pageVersions.pageId))
		.where(and(eq(pageVersions.pageId, pageId), readablePages(access)))
		.groupBy(users.id, users.username, users.displayName)
		.orderBy(order)
		.limit(Math.min(Math.max(options.limit ?? 10, 1), 50));
	return rows.map((row) => ({
		...row,
		lastUpdate: row.lastUpdate ? new Date(row.lastUpdate).toISOString() : null,
	}));
}

export async function latestAttachments(
	access: WikiAccess,
	pageId: string,
): Promise<AttachmentRow[]> {
	const rows = await db.execute(sql`
		select distinct on (a.file_name)
			a.id, a.page_id, a.file_name, a.mime_type, a.size, a.version,
			a.author_id, u.display_name as author, u.username as author_username,
			${userAvatarSql(sql`a.author_id`)} as author_avatar_url,
			a.created, a.comment, a.sha256
		from page_attachments a
		join pages p on p.id = a.page_id
		left join users u on u.id = a.author_id
		where a.page_id = ${pageId} and ${visibleRaw(access)}
		order by a.file_name, a.version desc
	`);
	return (rows.rows as Record<string, unknown>[]).map((row) => ({
		id: String(row.id),
		pageId: String(row.page_id),
		fileName: String(row.file_name),
		mimeType: row.mime_type === null ? null : String(row.mime_type),
		size: Number(row.size),
		version: Number(row.version),
		authorId: row.author_id === null ? null : String(row.author_id),
		author: row.author === null ? null : String(row.author),
		authorUsername:
			row.author_username === null ? null : String(row.author_username),
		authorAvatarUrl:
			row.author_avatar_url === null ? null : String(row.author_avatar_url),
		created:
			row.created === null
				? null
				: new Date(row.created as string).toISOString(),
		comment: row.comment === null ? null : String(row.comment),
		sha256: String(row.sha256),
	}));
}

export async function pageAttachmentVersions(
	access: WikiAccess,
	pageId: string,
): Promise<AttachmentRow[]> {
	const rows = await db
		.select({
			id: pageAttachments.id,
			pageId: pageAttachments.pageId,
			fileName: pageAttachments.fileName,
			mimeType: pageAttachments.mimeType,
			size: pageAttachments.size,
			version: pageAttachments.version,
			authorId: pageAttachments.authorId,
			author: users.displayName,
			authorUsername: users.username,
			authorAvatarUrl: userAvatarSql(users.id),
			created: pageAttachments.created,
			comment: pageAttachments.comment,
			sha256: pageAttachments.sha256,
		})
		.from(pageAttachments)
		.innerJoin(pages, eq(pages.id, pageAttachments.pageId))
		.leftJoin(users, eq(users.id, pageAttachments.authorId))
		.where(and(eq(pageAttachments.pageId, pageId), readablePages(access)))
		.orderBy(pageAttachments.fileName, desc(pageAttachments.version));
	return rows.map((row) => ({
		...row,
		created: row.created?.toISOString() ?? null,
	}));
}

export type IssueSummary = {
	key: string;
	summary: string;
	type: string;
	status: string;
	category: "new" | "indeterminate" | "done";
	priority: string | null;
	resolution: string | null;
	assignee: string | null;
};

export async function issueSummary(
	key: string,
	user: SearchUser | null,
): Promise<IssueSummary | null> {
	const visibleProjectIds = user ? await viewerProjectIds(user) : [];
	if (visibleProjectIds.length === 0) return null;
	const [row] = await db
		.select({
			key: issues.key,
			summary: issues.summary,
			type: issueTypes.name,
			status: statuses.name,
			category: statuses.category,
			priority: priorities.name,
			resolution: resolutions.name,
			assignee: users.displayName,
		})
		.from(issues)
		.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(priorities, eq(priorities.id, issues.priorityId))
		.leftJoin(resolutions, eq(resolutions.id, issues.resolutionId))
		.leftJoin(users, eq(users.id, issues.assigneeId))
		.where(
			and(
				eq(issues.key, key.toUpperCase()),
				inArray(issues.projectId, visibleProjectIds),
			),
		)
		.limit(1);
	return row ?? null;
}

export type JqlTable = {
	columns: string[];
	rows: { key: string; values: string[] }[];
};

export async function jqlTable(
	jql: string,
	columns: string[],
	user: SearchUser | null,
	limit: number,
): Promise<JqlTable | { error: string }> {
	try {
		const query = parseJql(jql);
		const compiled = await compileJql(query, {
			user,
			catalog: await loadCatalog(),
			visibleProjectIds: user ? await viewerProjectIds(user) : [],
		});
		const where = compiled.where ?? sql`true`;
		const orderBy = sql.join(compiled.orderBy, sql`, `);
		const result = await withStatementTimeout((tx) =>
			tx.execute(sql`
			select
				issues.key,
				issues.summary,
				it.name as type,
				s.name as status,
				p.name as priority,
				a.display_name as assignee,
				rp.display_name as reporter,
				res.name as resolution,
				issues.created,
				issues.updated
			from issues
			join issue_types it on it.id = issues.type_id
			join statuses s on s.id = issues.status_id
			left join priorities p on p.id = issues.priority_id
			left join users a on a.id = issues.assignee_id
			left join users rp on rp.id = issues.reporter_id
			left join resolutions res on res.id = issues.resolution_id
			where ${where}
			order by ${orderBy}
			limit ${limit}
		`),
		);
		const rows = (result.rows as Record<string, unknown>[]).map((row) => {
			const values: Record<string, string> = {
				key: String(row.key),
				summary: String(row.summary),
				type: String(row.type),
				status: String(row.status),
				priority: row.priority === null ? "" : String(row.priority),
				assignee: row.assignee === null ? "" : String(row.assignee),
				reporter: row.reporter === null ? "" : String(row.reporter),
				resolution: row.resolution === null ? "" : String(row.resolution),
				created:
					row.created === null
						? ""
						: new Date(row.created as string).toISOString().slice(0, 10),
				updated:
					row.updated === null
						? ""
						: new Date(row.updated as string).toISOString().slice(0, 10),
			};
			return {
				key: String(row.key),
				values: columns.map((column) => values[column] ?? ""),
			};
		});
		return { columns, rows };
	} catch (error) {
		if (error instanceof JqlError) return { error: error.jiraMessage };
		throw error;
	}
}

export type PagePropertyRow = {
	id: string;
	sourceId: string;
	title: string;
	spaceKey: string;
	values: Map<string, string>;
};

/** Pages in the given spaces that carry a page-properties (details) macro. */
export async function pagesWithProperties(
	access: WikiAccess,
	spaceIds: string[],
	limit = 100,
): Promise<PagePropertyRow[]> {
	if (spaceIds.length === 0) return [];
	const rows = await db
		.select({
			id: pages.id,
			sourceId: pages.sourceId,
			title: pages.title,
			spaceKey: spaces.key,
			bodyStorage: pages.bodyStorage,
		})
		.from(pages)
		.innerJoin(spaces, eq(spaces.id, pages.spaceId))
		.where(
			and(
				visiblePages(access),
				inArray(pages.spaceId, spaceIds),
				sql`${pages.bodyStorage} like '%ac:name="details"%'`,
			),
		)
		.orderBy(sql`lower(${pages.title})`)
		.limit(limit);

	const result: PagePropertyRow[] = [];
	for (const row of rows) {
		const macro = findMacros(row.bodyStorage ?? "").find(
			(candidate) => candidate.name === "details",
		);
		if (!macro) continue;
		const values = new Map<string, string>();
		for (const cell of (macro.body ?? "").matchAll(
			/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g,
		)) {
			values.set(stripTags(cell[1]), stripTags(cell[2]));
		}
		if (values.size === 0) continue;
		result.push({
			id: row.id,
			sourceId: row.sourceId,
			title: row.title,
			spaceKey: row.spaceKey,
			values,
		});
	}
	return result;
}
