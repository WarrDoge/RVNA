import {
	boardConfigSchema,
	boardParams,
	columnsBody,
} from "#lib/server/agile/schemas.ts";
import { replaceBoardColumns } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{
		params: boardParams,
		body: columnsBody,
		response: { 200: boardConfigSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		replaceBoardColumns(actor, params.rapidViewId, body),
);
