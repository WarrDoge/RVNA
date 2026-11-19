import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { renameBody, renamePage } from "#lib/server/wiki-edit/pages.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, params: idParams, body: renameBody },
	async ({ actor, params, body }) => renamePage(actor, params.id, body),
);
