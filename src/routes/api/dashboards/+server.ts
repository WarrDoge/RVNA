import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	createBody,
	dashboardDetailSchema,
	dashboardSummarySchema,
	listQuery,
} from "#lib/server/dashboards/schemas.ts";
import {
	createDashboard,
	listDashboards,
} from "#lib/server/dashboards/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ query: listQuery, response: z.array(dashboardSummarySchema) },
	async ({ actor, query }) => listDashboards(actor, query),
);

export const POST = endpoint(
	{
		body: createBody,
		response: { 201: dashboardDetailSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createDashboard(actor, body),
	}),
);
