import { endpoint } from "#lib/server/http.ts";
import {
	keyParams,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import {
	permissionsInput,
	replaceSpacePermissions,
} from "#lib/server/wiki-edit/spaces.ts";

export const PUT = endpoint(
	{
		validationError: wikiValidationError,
		params: keyParams,
		body: permissionsInput,
	},
	async ({ actor, params, body }) =>
		replaceSpacePermissions(actor, params.key, body),
);
