import {
	dashboardParams,
	favouriteSchema,
} from "#lib/server/dashboards/schemas.ts";
import {
	favouriteDashboard,
	unfavouriteDashboard,
} from "#lib/server/dashboards/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{ params: dashboardParams, response: favouriteSchema },
	async ({ actor, params }) => favouriteDashboard(actor, params.id),
);

export const DELETE = endpoint(
	{ params: dashboardParams, response: favouriteSchema },
	async ({ actor, params }) => unfavouriteDashboard(actor, params.id),
);
