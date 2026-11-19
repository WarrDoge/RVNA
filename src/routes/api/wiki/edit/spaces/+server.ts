import { endpoint } from "#lib/server/http.ts";
import { wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { listEditorSpaces } from "#lib/server/wiki-edit/support.ts";

export const GET = endpoint(
	{ validationError: wikiValidationError },
	async ({ actor }) => listEditorSpaces(actor),
);
