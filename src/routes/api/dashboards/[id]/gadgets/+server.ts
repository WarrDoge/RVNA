import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	dashboardParams,
	gadgetBody,
	gadgetSchema,
} from "#lib/server/dashboards/schemas.ts";
import { addGadget } from "#lib/server/dashboards/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		params: dashboardParams,
		body: gadgetBody,
		response: { 201: gadgetSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await addGadget(actor, params.id, body),
	}),
);
