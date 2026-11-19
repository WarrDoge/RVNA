import { endpoint } from "#lib/server/http.ts";
import {
	keyParams,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import { setSpaceStatus } from "#lib/server/wiki-edit/spaces.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, params: keyParams },
	async ({ actor, params }) => setSpaceStatus(actor, params.key, "current"),
);
