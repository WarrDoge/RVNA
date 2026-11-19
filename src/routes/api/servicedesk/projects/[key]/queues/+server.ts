import { endpoint } from "#lib/server/http.ts";
import {
	projectParams,
	queueListSchema,
} from "#lib/server/servicedesk/schemas.ts";
import { deskQueues } from "#lib/server/servicedesk/service.ts";

export const GET = endpoint(
	{ params: projectParams, response: queueListSchema },
	async ({ actor, params }) => deskQueues(actor, params.key),
);
