import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	queuePageSchema,
	queueParams,
	queueQuerySchema,
} from "#lib/server/servicedesk/schemas.ts";
import { deskQueue } from "#lib/server/servicedesk/service.ts";

export const GET = endpoint(
	{
		params: queueParams,
		query: queueQuerySchema,
		response: { 200: queuePageSchema, 400: errorSchema },
	},
	async ({ actor, params, query }) =>
		deskQueue(actor, params.key, params.queueId, {
			startAt: query.startAt,
			maxResults: query.maxResults,
		}),
);
