import {
	boardDataSchema,
	boardParams,
	searchQuery,
} from "#lib/server/agile/schemas.ts";
import { getBoardData } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		params: boardParams,
		query: searchQuery,
		response: { 200: boardDataSchema, 400: errorSchema },
	},
	async ({ actor, params, query }) =>
		getBoardData(actor, params.rapidViewId, query),
);
