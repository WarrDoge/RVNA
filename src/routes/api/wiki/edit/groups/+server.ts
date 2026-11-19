import { endpoint } from "#lib/server/http.ts";
import { wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { groupsQuery, listGroups } from "#lib/server/wiki-edit/support.ts";

export const GET = endpoint(
	{ validationError: wikiValidationError, query: groupsQuery },
	async ({ actor, query }) => listGroups(actor, query),
);
