import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import { boardParams, reportQuery } from "#lib/server/reports/schemas.ts";
import { sprintReport } from "#lib/server/reports/service.ts";

export const GET = endpoint(
	{
		params: boardParams,
		query: reportQuery,
		response: { 200: z.any(), 400: errorSchema },
	},
	async ({ actor, params, query }) =>
		sprintReport(actor, params.rapidViewId, query),
);
