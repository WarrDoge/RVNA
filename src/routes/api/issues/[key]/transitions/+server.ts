import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	issueDetailWithCustomFieldsSchema,
	issueParams,
	transitionBody,
} from "#lib/server/issues/schemas.ts";
import { transitionIssue } from "#lib/server/issues/service.ts";

export const POST = endpoint(
	{
		params: issueParams,
		body: transitionBody,
		response: { 200: issueDetailWithCustomFieldsSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => transitionIssue(actor, params.key, body),
);
