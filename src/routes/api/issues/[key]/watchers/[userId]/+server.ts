import { endpoint } from "#lib/server/http.ts";
import { watcherParams, watchersResponse } from "#lib/server/issues/schemas.ts";
import { removeWatcher } from "#lib/server/issues/service.ts";

export const DELETE = endpoint(
	{ params: watcherParams, response: watchersResponse },
	async ({ actor, params }) => removeWatcher(actor, params.key, params.userId),
);
