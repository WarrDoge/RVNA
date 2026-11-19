import {
	gadgetDataQuery,
	gadgetParams,
} from "#lib/server/dashboards/schemas.ts";
import { getGadgetData } from "#lib/server/dashboards/service.ts";
import { gadgetDataSchema } from "#lib/server/gadget-data.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		params: gadgetParams,
		query: gadgetDataQuery,
		response: gadgetDataSchema,
	},
	async ({ actor, params, query }) =>
		getGadgetData(actor, params.id, query.startAt),
);
