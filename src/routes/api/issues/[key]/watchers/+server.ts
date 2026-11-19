import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	issueParams,
	watcherBody,
	watchersResponse,
} from "#lib/server/issues/schemas.ts";
import { addWatcher, listWatchers } from "#lib/server/issues/service.ts";

export const GET = endpoint(
	{ params: issueParams, response: watchersResponse },
	async ({ actor, params }) => listWatchers(actor, params.key),
);

export const POST = endpoint(
	{
		params: issueParams,
		body: watcherBody,
		response: { 200: watchersResponse, 400: errorSchema },
	},
	async ({ actor, params, body }) => addWatcher(actor, params.key, body.userId),
);
