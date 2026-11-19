import { endpoint } from "#lib/server/http.ts";
import {
	keyParams,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import { listSpacePermissions } from "#lib/server/wiki-edit/spaces.ts";

export const GET = endpoint(
	{ validationError: wikiValidationError, params: keyParams },
	async ({ actor, params }) => listSpacePermissions(actor, params.key),
);
