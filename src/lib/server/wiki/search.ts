import { sql } from "drizzle-orm";
import { db } from "../db.ts";
import type { WikiAccess } from "./permissions.ts";
import { escapeHtml } from "./storage.ts";

export interface WikiSearchOptions {
	query: string;
	spaceKey?: string | null;
	contributor?: string | null;
	from?: string | null;
	to?: string | null;
	limit?: number;
	offset?: number;
}

export interface WikiSearchHit {
	id: string;
	sourceId: string;
	title: string;
	spaceKey: string;
	spaceName: string;
	excerpt: string;
	updated: string | null;
	author: string | null;
	rank: number;
}

export interface WikiSearchResult {
	total: number;
	offset: number;
	limit: number;
	hits: WikiSearchHit[];
}

function accessFilter(access: WikiAccess) {
	const ids = [...access.readableSpaceIds];
	const readable =
		ids.length > 0
			? sql`p.space_id in (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `,
				)})`
			: sql`false`;
	if (access.hiddenPageIds.size === 0) return readable;
	const hidden = sql.join(
		[...access.hiddenPageIds].map((id) => sql`${id}`),
		sql`, `,
	);
	return sql`${readable} and p.id not in (${hidden})`;
}

function plainText(html: string | null): string {
	if (!html) return "";
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

function terms(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^\p{L}\p{N}_]+/u)
		.filter((term) => term.length > 1);
}

/** A window of the body around the first matching term, with <mark> hits. */
export function excerpt(bodyHtml: string | null, query: string): string {
	const text = plainText(bodyHtml);
	if (text === "") return "";
	const needles = terms(query);
	if (needles.length === 0) return escapeHtml(text.slice(0, 200));

	const lower = text.toLowerCase();
	let at = -1;
	for (const needle of needles) {
		const index = lower.indexOf(needle);
		if (index !== -1 && (at === -1 || index < at)) at = index;
	}
	if (at === -1) return escapeHtml(text.slice(0, 200));

	const start = Math.max(0, at - 70);
	const end = Math.min(text.length, at + 130);
	const window = text.slice(start, end);
	const escaped = escapeHtml(window);
	return needles.reduce(
		(result, needle) =>
			result.replace(
				new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
				"<mark>$1</mark>",
			),
		escaped,
	);
}

export async function searchWikiPages(
	access: WikiAccess,
	options: WikiSearchOptions,
): Promise<WikiSearchResult> {
	const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
	const offset = Math.max(options.offset ?? 0, 0);
	const query = options.query.trim();

	const filters = [sql`p.status = 'current'`, accessFilter(access)];

	if (query !== "") {
		filters.push(sql`(
			p.search @@ websearch_to_tsquery('simple', ${query})
			or p.title ilike ${`%${query.replace(/[%_\\]/g, "\\$&")}%`}
			or similarity(p.title, ${query}) > 0.3
		)`);
	}
	if (options.spaceKey) {
		filters.push(sql`s.key = ${options.spaceKey}`);
	}
	if (options.contributor) {
		filters.push(sql`(
			exists (
				select 1 from users cu
				where cu.id = p.creator_id
					and (cu.username = ${options.contributor} or cu.id::text = ${options.contributor})
			)
			or exists (
				select 1 from users mu
				where mu.id = p.last_modifier_id
					and (mu.username = ${options.contributor} or mu.id::text = ${options.contributor})
			)
			or exists (
				select 1 from page_versions pv
				join users vu on vu.id = pv.author_id
				where pv.page_id = p.id
					and (vu.username = ${options.contributor} or vu.id::text = ${options.contributor})
			)
		)`);
	}
	if (options.from)
		filters.push(sql`p.updated >= ${options.from}::timestamptz`);
	if (options.to) filters.push(sql`p.updated <= ${options.to}::timestamptz`);

	const where = sql.join(filters, sql` and `);
	const rank =
		query === ""
			? sql`0::float4`
			: sql`ts_rank(
					setweight(to_tsvector('simple', p.title), 'A')
					|| setweight(coalesce(p.search, ''::tsvector), 'B'),
					websearch_to_tsquery('simple', ${query})
				) + case when p.title ilike ${`%${query.replace(/[%_\\]/g, "\\$&")}%`} then 0.5 else 0 end
				+ case when similarity(p.title, ${query}) > 0.3 then 0.25 else 0 end`;

	const total = await db.execute(sql`
		select count(*)::int as total
		from pages p
		join spaces s on s.id = p.space_id
		where ${where}
	`);

	const rows = await db.execute(sql`
		select
			p.id, p.source_id, p.title, p.body_html, p.updated,
			s.key as space_key, s.name as space_name,
			u.display_name as author,
			${rank} as rank
		from pages p
		join spaces s on s.id = p.space_id
		left join users u on u.id = p.last_modifier_id
		where ${where}
		order by rank desc, p.updated desc nulls last
		limit ${limit} offset ${offset}
	`);

	const hits = (rows.rows as Record<string, unknown>[]).map((row) => ({
		id: String(row.id),
		sourceId: String(row.source_id),
		title: String(row.title),
		spaceKey: String(row.space_key),
		spaceName: String(row.space_name),
		excerpt: excerpt(
			row.body_html === null ? null : String(row.body_html),
			query,
		),
		updated:
			row.updated === null
				? null
				: new Date(row.updated as string).toISOString(),
		author: row.author === null ? null : String(row.author),
		rank: Number(row.rank),
	}));

	return {
		total: Number((total.rows[0] as { total: number }).total),
		offset,
		limit,
		hits,
	};
}

export interface WikiSearchSuggestion {
	id: string;
	sourceId: string;
	title: string;
	spaceKey: string;
	spaceName: string;
}

/** Title-only suggestions for the top bar search. */
export async function suggestWikiPages(
	access: WikiAccess,
	query: string,
	limit = 8,
): Promise<WikiSearchSuggestion[]> {
	const trimmed = query.trim();
	if (trimmed === "") return [];
	const rows = await db.execute(sql`
		select p.id, p.source_id, p.title, s.key as space_key, s.name as space_name
		from pages p
		join spaces s on s.id = p.space_id
		where p.status = 'current'
			and ${accessFilter(access)}
			and (p.title ilike ${`%${trimmed.replace(/[%_\\]/g, "\\$&")}%`}
				or similarity(p.title, ${trimmed}) > 0.25)
		order by
			case when lower(p.title) = lower(${trimmed}) then 0 else 1 end,
			case when p.title ilike ${`${trimmed.replace(/[%_\\]/g, "\\$&")}%`} then 0 else 1 end,
			similarity(p.title, ${trimmed}) desc
		limit ${Math.min(Math.max(limit, 1), 20)}
	`);
	return (rows.rows as Record<string, unknown>[]).map((row) => ({
		id: String(row.id),
		sourceId: String(row.source_id),
		title: String(row.title),
		spaceKey: String(row.space_key),
		spaceName: String(row.space_name),
	}));
}
