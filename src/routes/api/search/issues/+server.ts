import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	columnList,
	DEFAULT_PAGE,
	MAX_PAGE,
	navigatorPage,
	navigatorPageSchema,
} from "#lib/server/navigator/service.ts";
import { offsetQuery } from "#lib/server/paging.ts";

const searchQuery = z.object({
	jql: z.string().min(1).max(100_000),
	startAt: offsetQuery,
	maxResults: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_PAGE)
		.default(DEFAULT_PAGE),
	columns: z.string().max(10_000).optional(),
});

export const GET = endpoint(
	{
		query: searchQuery,
		response: { 200: navigatorPageSchema, 400: errorSchema },
	},
	async ({ actor, query }) =>
		navigatorPage(actor, {
			jql: query.jql,
			startAt: query.startAt,
			maxResults: query.maxResults,
			columns: columnList(query.columns),
		}),
);
