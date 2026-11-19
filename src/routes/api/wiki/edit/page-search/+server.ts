import { endpoint } from "#lib/server/http.ts";
import { wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { searchPages, searchQuery } from "#lib/server/wiki-edit/support.ts";

export const GET = endpoint(
	{ validationError: wikiValidationError, query: searchQuery },
	async ({ actor, query }) => searchPages(actor, query),
);
