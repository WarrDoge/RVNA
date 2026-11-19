import { z } from "zod";
import { JqlError } from "../shared/jql/index.ts";
import { issueTypeRefSchema, statusRefSchema } from "./api-schemas.ts";
import type { CurrentUser } from "./auth.ts";
import { HttpError } from "./http.ts";
import { loadNavigatorPage } from "./navigator/service.ts";
import { searchPages } from "./search-pages.ts";

const PAGE_LIMIT = 5;

function escapeJql(value: string) {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export const globalSearchResponseSchema = z.object({
	issues: z.object({
		total: z.number().int(),
		startAt: z.number().int(),
		maxResults: z.number().int(),
		items: z.array(
			z.object({
				id: z.uuid(),
				key: z.string(),
				summary: z.string(),
				type: issueTypeRefSchema,
				status: statusRefSchema,
				updated: z.iso.datetime().nullable(),
			}),
		),
	}),
	pages: z.object({
		total: z.number().int(),
		items: z.array(
			z.object({
				id: z.string(),
				title: z.string(),
				spaceKey: z.string(),
				spaceName: z.string(),
				updated: z.iso.datetime().nullable(),
			}),
		),
	}),
});

export type GlobalSearchResult = z.infer<typeof globalSearchResponseSchema>;

export async function globalSearch(
	user: CurrentUser,
	query: { q: string; startAt: number; maxResults: number },
): Promise<GlobalSearchResult> {
	if (query.q === "") {
		return {
			issues: {
				total: 0,
				startAt: 0,
				maxResults: query.maxResults,
				items: [],
			},
			pages: { total: 0, items: [] },
		};
	}

	const pages = await searchPages(user, query.q, PAGE_LIMIT);

	let page: Awaited<ReturnType<typeof loadNavigatorPage>>;
	try {
		page = await loadNavigatorPage(
			{
				jql: `text ~ "${escapeJql(query.q)}" ORDER BY updated DESC`,
				startAt: query.startAt,
				maxResults: query.maxResults,
				columns: ["type", "key", "summary", "status", "updated"],
			},
			user,
		);
	} catch (error) {
		if (error instanceof JqlError) {
			throw new HttpError(400, error.jiraMessage);
		}
		throw error;
	}

	return {
		issues: {
			total: page.total,
			startAt: page.startAt,
			maxResults: page.maxResults,
			items: page.issues.map((issue) => ({
				id: issue.id,
				key: issue.key,
				summary: issue.summary,
				type: issue.type,
				status: issue.status,
				updated: issue.updated,
			})),
		},
		pages: { total: pages.total, items: pages.pages },
	};
}
