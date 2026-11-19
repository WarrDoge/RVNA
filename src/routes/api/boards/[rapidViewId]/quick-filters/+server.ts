import {
	boardConfigSchema,
	boardParams,
	quickFiltersBody,
} from "#lib/server/agile/schemas.ts";
import { replaceBoardQuickFilters } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{
		params: boardParams,
		body: quickFiltersBody,
		response: { 200: boardConfigSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		replaceBoardQuickFilters(actor, params.rapidViewId, body),
);
