import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { heartbeatLock } from "#lib/server/wiki-edit/locks.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, params: idParams },
	async ({ actor, params }) => heartbeatLock(actor, params.id),
);
