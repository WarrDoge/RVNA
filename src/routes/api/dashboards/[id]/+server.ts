import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	dashboardDetailSchema,
	dashboardParams,
	patchBody,
} from "#lib/server/dashboards/schemas.ts";
import {
	getDashboard,
	removeDashboard,
	updateDashboard,
} from "#lib/server/dashboards/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ params: dashboardParams, response: dashboardDetailSchema },
	async ({ actor, params }) => getDashboard(actor, params.id),
);

export const PATCH = endpoint(
	{
		params: dashboardParams,
		body: patchBody,
		response: { 200: dashboardDetailSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateDashboard(actor, params.id, body),
);

export const DELETE = endpoint(
	{ params: dashboardParams, response: z.void() },
	async ({ actor, params }) => {
		await removeDashboard(actor, params.id);
		return { status: 204 };
	},
);
