import { endpoint } from "#lib/server/http.ts";
import { searchQuery, searchResultSchema } from "#lib/server/wiki/schemas.ts";
import { searchPages } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ query: searchQuery, response: searchResultSchema },
	async ({ actor, query }) => searchPages(actor, query),
);
