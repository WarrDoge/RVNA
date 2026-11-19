import { endpoint } from "#lib/server/http.ts";
import { suggestQuery, suggestSchema } from "#lib/server/wiki/schemas.ts";
import { suggestPages } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ query: suggestQuery, response: suggestSchema },
	async ({ actor, query }) => suggestPages(actor, query.query, query.limit),
);
