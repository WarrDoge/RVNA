import { endpoint } from "#lib/server/http.ts";
import {
	docBodyLimit,
	wikiValidationError,
} from "#lib/server/wiki-edit/common.ts";
import { createBody, createPage } from "#lib/server/wiki-edit/pages.ts";

export const POST = endpoint(
	{
		validationError: wikiValidationError,
		bodyLimit: docBodyLimit,
		body: createBody,
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createPage(actor, body),
	}),
);
