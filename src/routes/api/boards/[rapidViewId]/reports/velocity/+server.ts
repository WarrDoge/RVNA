import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import { boardParams, velocityQuery } from "#lib/server/reports/schemas.ts";
import { velocityReport } from "#lib/server/reports/service.ts";

export const GET = endpoint(
	{
		params: boardParams,
		query: velocityQuery,
		response: { 200: z.any(), 400: errorSchema },
	},
	async ({ actor, params, query }) =>
		velocityReport(actor, params.rapidViewId, query),
);
