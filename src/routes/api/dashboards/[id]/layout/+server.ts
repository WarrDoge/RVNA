import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	dashboardDetailSchema,
	dashboardParams,
	layoutBody,
} from "#lib/server/dashboards/schemas.ts";
import { setDashboardLayout } from "#lib/server/dashboards/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{
		params: dashboardParams,
		body: layoutBody,
		response: { 200: dashboardDetailSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => setDashboardLayout(actor, params.id, body),
);
