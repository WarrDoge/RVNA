import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { listPageRestrictions } from "#lib/server/wiki-edit/restrictions.ts";

export const GET = endpoint(
	{ validationError: wikiValidationError, params: idParams },
	async ({ actor, params }) => listPageRestrictions(actor, params.id),
);
