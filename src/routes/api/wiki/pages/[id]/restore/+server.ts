import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { restorePage } from "#lib/server/wiki-edit/tree.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, params: idParams },
	async ({ actor, params }) => restorePage(actor, params.id),
);
