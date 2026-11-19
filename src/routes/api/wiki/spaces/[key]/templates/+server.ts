import { endpoint } from "#lib/server/http.ts";
import {
	docBodyLimit,
	keyParams,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import { createTemplate, templateBody } from "#lib/server/wiki-edit/spaces.ts";

export const POST = endpoint(
	{
		validationError: wikiValidationError,
		bodyLimit: docBodyLimit,
		params: keyParams,
		body: templateBody,
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await createTemplate(actor, params.key, body),
	}),
);
