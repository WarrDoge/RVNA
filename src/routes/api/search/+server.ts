import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { endpoint, isHttpError, jsonResponse } from "#lib/server/http.ts";
import { MAX_OFFSET, offsetQuery } from "#lib/server/paging.ts";
import {
	DEFAULT_MAX_RESULTS,
	MAX_RESULTS_LIMIT,
	type SearchRequest,
	type SearchResult,
	search,
} from "#lib/server/search/service.ts";

const issueSchema = z.object({
	key: z.string(),
	summary: z.string(),
	type: z.string(),
	status: z.string(),
	priority: z.string().nullable(),
	assignee: z
		.object({ username: z.string(), displayName: z.string() })
		.nullable(),
	reporter: z
		.object({ username: z.string(), displayName: z.string() })
		.nullable(),
	resolution: z.string().nullable(),
	created: z.string().nullable(),
	updated: z.string().nullable(),
	storyPoints: z.number().nullable(),
	labels: z.array(z.string()),
});

const errorSchema = z.object({ errors: z.array(z.string()) });

const resultSchema = z.object({
	startAt: z.number().int(),
	maxResults: z.number().int(),
	total: z.number().int(),
	issues: z.array(issueSchema),
});

const searchBody = z.object({
	jql: z.string().min(1).max(100_000),
	startAt: z.number().int().min(0).max(MAX_OFFSET).optional(),
	maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional(),
});

const searchQuery = z.object({
	jql: z.string().min(1).max(100_000),
	startAt: offsetQuery,
	maxResults: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_RESULTS_LIMIT)
		.default(DEFAULT_MAX_RESULTS),
});

const responseSchema = z.union([resultSchema, errorSchema]);

async function runSearch(
	actor: Parameters<typeof search>[0],
	request: SearchRequest,
): Promise<SearchResult | { status: number; body: { errors: string[] } }> {
	try {
		return await search(actor, request);
	} catch (error) {
		if (isHttpError(error) && error.status === 400) {
			return { status: 400, body: { errors: [error.message] } };
		}
		throw error;
	}
}

/** Search answers validation errors as `{ errors: [...] }`. */
function searchErrors(handler: RequestHandler): RequestHandler {
	return async (event) => {
		const response = await handler(event);
		if (response.status !== 400) return response;
		try {
			const body = (await response.clone().json()) as {
				code?: string;
				message?: string;
			};
			if (
				body.code === "FST_ERR_VALIDATION" &&
				typeof body.message === "string"
			) {
				return jsonResponse({ errors: [body.message] }, { status: 400 });
			}
		} catch {
			// Not a JSON validation body; leave the response alone.
		}
		return response;
	};
}

export const GET = searchErrors(
	endpoint(
		{ query: searchQuery, response: responseSchema },
		async ({ actor, query }) =>
			runSearch(actor, {
				jql: query.jql,
				startAt: query.startAt,
				maxResults: query.maxResults,
			}),
	),
);

export const POST = searchErrors(
	endpoint(
		{ body: searchBody, response: responseSchema },
		async ({ actor, body }) =>
			runSearch(actor, {
				jql: body.jql,
				startAt: body.startAt ?? 0,
				maxResults: body.maxResults ?? DEFAULT_MAX_RESULTS,
			}),
	),
);
