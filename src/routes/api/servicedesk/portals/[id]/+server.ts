import { endpoint } from "#lib/server/http.ts";
import {
	portalDetailSchema,
	portalParams,
} from "#lib/server/servicedesk/schemas.ts";
import { portalDetail } from "#lib/server/servicedesk/service.ts";

export const GET = endpoint(
	{ params: portalParams, response: portalDetailSchema },
	async ({ actor, params }) => portalDetail(actor, params.id),
);
