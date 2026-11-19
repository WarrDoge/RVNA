import {
	boardConfigSchema,
	boardParams,
	swimlanesBody,
} from "#lib/server/agile/schemas.ts";
import { replaceBoardSwimlanes } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{
		params: boardParams,
		body: swimlanesBody,
		response: { 200: boardConfigSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		replaceBoardSwimlanes(actor, params.rapidViewId, body),
);
