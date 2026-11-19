import { endpoint } from "#lib/server/http.ts";
import { pageParams, restrictionSchema } from "#lib/server/wiki/schemas.ts";
import { getPageRestrictions } from "#lib/server/wiki/service.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import {
	replacePageRestrictions,
	restrictionsBody,
} from "#lib/server/wiki-edit/restrictions.ts";

export const GET = endpoint(
	{ params: pageParams, response: restrictionSchema },
	async ({ actor, params }) => getPageRestrictions(actor, params.id),
);

export const PUT = endpoint(
	{
		validationError: wikiValidationError,
		params: idParams,
		body: restrictionsBody,
	},
	async ({ actor, params, body }) =>
		replacePageRestrictions(actor, params.id, body),
);
