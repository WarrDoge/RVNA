import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import { boardParams, cfdQuery } from "#lib/server/reports/schemas.ts";
import { cumulativeFlowReport } from "#lib/server/reports/service.ts";

export const GET = endpoint(
	{
		params: boardParams,
		query: cfdQuery,
		response: { 200: z.any(), 400: errorSchema },
	},
	async ({ actor, params, query }) =>
		cumulativeFlowReport(actor, params.rapidViewId, query),
);
