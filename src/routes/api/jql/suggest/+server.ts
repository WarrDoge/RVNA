import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { DEFAULT_SUGGEST_LIMIT, suggest } from "#lib/server/jql/suggest.ts";

const suggestQuery = z.object({
	field: z.string().trim().min(1).max(200),
	prefix: z.string().max(200).default(""),
	limit: z.coerce.number().int().min(1).max(50).default(DEFAULT_SUGGEST_LIMIT),
});

const responseSchema = z.object({ values: z.array(z.string()) });

export const GET = endpoint(
	{ query: suggestQuery, response: responseSchema },
	async ({ actor, query }) => suggest(actor, query),
);
