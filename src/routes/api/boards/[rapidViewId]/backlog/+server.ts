import {
	backlogDataSchema,
	boardParams,
	searchQuery,
} from "#lib/server/agile/schemas.ts";
import { getBacklog } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		params: boardParams,
		query: searchQuery,
		response: { 200: backlogDataSchema, 400: errorSchema },
	},
	async ({ actor, params, query }) =>
		getBacklog(actor, params.rapidViewId, query),
);
