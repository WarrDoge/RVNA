import { endpoint } from "#lib/server/http.ts";
import {
	excerptQuery,
	excerptSchema,
	pageParams,
} from "#lib/server/wiki/schemas.ts";
import { getPageExcerpt } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: pageParams, query: excerptQuery, response: excerptSchema },
	async ({ actor, params, query }) =>
		getPageExcerpt(actor, params.id, query.query),
);
