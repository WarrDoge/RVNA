import { endpoint } from "#lib/server/http.ts";
import {
	pageIdParams,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import { getEditorContext } from "#lib/server/wiki-edit/support.ts";

export const GET = endpoint(
	{ validationError: wikiValidationError, params: pageIdParams },
	async ({ actor, params }) => getEditorContext(actor, params.id),
);
