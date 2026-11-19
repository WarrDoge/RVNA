import { endpoint } from "#lib/server/http.ts";
import {
	spaceParams,
	spaceWatchSchema,
	watchBody,
} from "#lib/server/wiki/schemas.ts";
import { getSpaceWatch, setSpaceWatch } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: spaceParams, response: spaceWatchSchema },
	async ({ actor, params }) => getSpaceWatch(actor, params.key),
);

export const POST = endpoint(
	{ params: spaceParams, body: watchBody, response: spaceWatchSchema },
	async ({ actor, params, body }) =>
		setSpaceWatch(actor, params.key, body.watching),
);
