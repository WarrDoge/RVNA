import { endpoint } from "#lib/server/http.ts";
import { spaceParams, spaceSummarySchema } from "#lib/server/wiki/schemas.ts";
import { getSpace } from "#lib/server/wiki/service.ts";
import {
	keyParams,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import {
	deleteSpace,
	updateSpace,
	updateSpaceBody,
} from "#lib/server/wiki-edit/spaces.ts";

export const GET = endpoint(
	{ params: spaceParams, response: spaceSummarySchema },
	async ({ actor, params }) => getSpace(actor, params.key),
);

export const PUT = endpoint(
	{
		validationError: wikiValidationError,
		params: keyParams,
		body: updateSpaceBody,
	},
	async ({ actor, params, body }) => updateSpace(actor, params.key, body),
);

export const DELETE = endpoint(
	{ validationError: wikiValidationError, params: keyParams },
	async ({ actor, params }) => {
		await deleteSpace(actor, params.key);
		return { status: 204 };
	},
);
