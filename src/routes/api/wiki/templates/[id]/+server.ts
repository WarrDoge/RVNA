import { endpoint } from "#lib/server/http.ts";
import {
	docBodyLimit,
	idParams,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import {
	deleteTemplate,
	templateBody,
	updateTemplate,
} from "#lib/server/wiki-edit/spaces.ts";

export const PUT = endpoint(
	{
		validationError: wikiValidationError,
		bodyLimit: docBodyLimit,
		params: idParams,
		body: templateBody,
	},
	async ({ actor, params, body }) => updateTemplate(actor, params.id, body),
);

export const DELETE = endpoint(
	{ validationError: wikiValidationError, params: idParams },
	async ({ actor, params }) => {
		await deleteTemplate(actor, params.id);
		return { status: 204 };
	},
);
