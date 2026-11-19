import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { trashPage } from "#lib/server/wiki-edit/tree.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, params: idParams },
	async ({ actor, params }) => trashPage(actor, params.id),
);
