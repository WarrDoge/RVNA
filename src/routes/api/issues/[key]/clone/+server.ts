import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	cloneIssueBody,
	issueDetailWithCustomFieldsSchema,
	issueParams,
} from "#lib/server/issues/schemas.ts";
import { cloneIssue } from "#lib/server/issues/service.ts";

export const POST = endpoint(
	{
		params: issueParams,
		body: cloneIssueBody,
		response: { 201: issueDetailWithCustomFieldsSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await cloneIssue(actor, params.key, body),
	}),
);
