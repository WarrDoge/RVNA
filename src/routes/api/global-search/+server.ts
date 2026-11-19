import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	globalSearch,
	globalSearchResponseSchema,
} from "#lib/server/global-search.ts";
import { endpoint } from "#lib/server/http.ts";

const query = z.object({
	q: z.string().trim().max(200).default(""),
	startAt: z.coerce.number().int().min(0).default(0),
	maxResults: z.coerce.number().int().min(1).max(50).default(25),
});

export const GET = endpoint(
	{ query, response: { 200: globalSearchResponseSchema, 400: errorSchema } },
	async ({ actor, query }) => globalSearch(actor, query),
);
