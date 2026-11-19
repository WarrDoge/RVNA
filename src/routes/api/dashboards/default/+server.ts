import { dashboardDetailSchema } from "#lib/server/dashboards/schemas.ts";
import { defaultDashboard } from "#lib/server/dashboards/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ response: dashboardDetailSchema },
	async ({ actor }) => defaultDashboard(actor),
);
