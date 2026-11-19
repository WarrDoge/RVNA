import { endpoint } from "#lib/server/http.ts";
import {
	pageParams,
	pageWatchSchema,
	watchBody,
} from "#lib/server/wiki/schemas.ts";
import { getPageWatch, setPageWatch } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: pageParams, response: pageWatchSchema },
	async ({ actor, params }) => getPageWatch(actor, params.id),
);

export const POST = endpoint(
	{ params: pageParams, body: watchBody, response: pageWatchSchema },
	async ({ actor, params, body }) =>
		setPageWatch(actor, params.id, body.watching),
);
