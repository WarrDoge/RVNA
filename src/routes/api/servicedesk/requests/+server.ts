import { endpoint } from "#lib/server/http.ts";
import {
	myRequestsQuerySchema,
	myRequestsSchema,
} from "#lib/server/servicedesk/schemas.ts";
import { listMyRequests } from "#lib/server/servicedesk/service.ts";

export const GET = endpoint(
	{ query: myRequestsQuerySchema, response: myRequestsSchema },
	async ({ actor, query }) =>
		listMyRequests(actor, {
			status: query.status,
			scope: query.scope,
			query: query.q,
		}),
);
