import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { moveBody, movePage } from "#lib/server/wiki-edit/tree.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, params: idParams, body: moveBody },
	async ({ actor, params, body }) => movePage(actor, params.id, body),
);
