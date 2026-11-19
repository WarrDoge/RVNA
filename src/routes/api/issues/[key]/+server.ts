import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	issueDetailWithCustomFieldsSchema,
	issueParams,
	updateIssueBody,
} from "#lib/server/issues/schemas.ts";
import {
	deleteIssue,
	getIssue,
	updateIssue,
} from "#lib/server/issues/service.ts";
import { recordIssueView } from "#lib/server/navigator/service.ts";

export const GET = endpoint(
	{ params: issueParams, response: issueDetailWithCustomFieldsSchema },
	async ({ actor, params }) => {
		const issue = await getIssue(actor, params.key);
		await recordIssueView(actor, issue.id);
		return issue;
	},
);

export const PATCH = endpoint(
	{
		params: issueParams,
		body: updateIssueBody,
		response: { 200: issueDetailWithCustomFieldsSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateIssue(actor, params.key, body),
);

export const DELETE = endpoint(
	{ params: issueParams },
	async ({ actor, params }) => {
		await deleteIssue(actor, params.key);
		return { status: 204 };
	},
);
