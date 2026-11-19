import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { copyBody, copyPage } from "#lib/server/wiki-edit/tree.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, params: idParams, body: copyBody },
	async ({ actor, params, body }) => ({
		status: 201,
		body: await copyPage(actor, params.id, body),
	}),
);
