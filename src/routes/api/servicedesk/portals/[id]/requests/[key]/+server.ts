import { endpoint } from "#lib/server/http.ts";
import {
	customerRequestSchema,
	requestParams,
} from "#lib/server/servicedesk/schemas.ts";
import { portalRequest } from "#lib/server/servicedesk/service.ts";

export const GET = endpoint(
	{ params: requestParams, response: customerRequestSchema },
	async ({ actor, params }) => portalRequest(actor, params.id, params.key),
);
