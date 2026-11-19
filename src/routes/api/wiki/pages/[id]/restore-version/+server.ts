import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import {
	restoreVersion,
	restoreVersionBody,
} from "#lib/server/wiki-edit/pages.ts";

export const POST = endpoint(
	{
		validationError: wikiValidationError,
		params: idParams,
		body: restoreVersionBody,
	},
	async ({ actor, params, body }) => restoreVersion(actor, params.id, body),
);
