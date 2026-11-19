import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { getTemplate } from "#lib/server/wiki-edit/spaces.ts";

export const GET = endpoint(
	{ validationError: wikiValidationError, params: idParams },
	async ({ actor, params }) => getTemplate(actor, params.id),
);
