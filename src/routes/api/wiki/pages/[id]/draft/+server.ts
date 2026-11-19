import { endpoint } from "#lib/server/http.ts";
import {
	docBodyLimit,
	idParams,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import {
	discardDraft,
	saveDraft,
	saveDraftBody,
} from "#lib/server/wiki-edit/drafts.ts";

export const PUT = endpoint(
	{
		validationError: wikiValidationError,
		bodyLimit: docBodyLimit,
		params: idParams,
		body: saveDraftBody,
	},
	async ({ actor, params, body }) => saveDraft(actor, params.id, body),
);

export const DELETE = endpoint(
	{ validationError: wikiValidationError, params: idParams },
	async ({ actor, params }) => {
		await discardDraft(actor, params.id);
		return { status: 204 };
	},
);
