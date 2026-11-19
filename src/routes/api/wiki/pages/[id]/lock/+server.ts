import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import {
	acquireLock,
	lockBody,
	releaseLock,
} from "#lib/server/wiki-edit/locks.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, params: idParams, body: lockBody },
	async ({ actor, params, body }) => acquireLock(actor, params.id, body),
);

export const DELETE = endpoint(
	{ validationError: wikiValidationError, params: idParams },
	async ({ actor, params }) => {
		await releaseLock(actor, params.id);
		return { status: 204 };
	},
);
