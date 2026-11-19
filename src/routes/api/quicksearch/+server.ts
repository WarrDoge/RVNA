import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import {
	quickSearch,
	quickSearchResponseSchema,
} from "#lib/server/quicksearch.ts";

const query = z.object({
	q: z.string().trim().max(200).default(""),
});

export const GET = endpoint(
	{ query, response: quickSearchResponseSchema },
	async ({ actor, query }) => quickSearch(actor, query.q),
);
