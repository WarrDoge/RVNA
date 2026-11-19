import { endpoint } from "#lib/server/http.ts";
import {
	pageDetailSchema,
	pageParams,
	pageQuery,
} from "#lib/server/wiki/schemas.ts";
import { getPage } from "#lib/server/wiki/service.ts";
import {
	docBodyLimit,
	idParams,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import { updateBody, updatePage } from "#lib/server/wiki-edit/pages.ts";
import { purgePage } from "#lib/server/wiki-edit/tree.ts";

export const GET = endpoint(
	{ params: pageParams, query: pageQuery, response: pageDetailSchema },
	async ({ actor, params, query }) => getPage(actor, params.id, query.version),
);

export const PUT = endpoint(
	{
		validationError: wikiValidationError,
		bodyLimit: docBodyLimit,
		params: idParams,
		body: updateBody,
	},
	async ({ actor, params, body }) => updatePage(actor, params.id, body),
);

export const DELETE = endpoint(
	{ validationError: wikiValidationError, params: idParams },
	async ({ actor, params }) => {
		await purgePage(actor, params.id);
		return { status: 204 };
	},
);
