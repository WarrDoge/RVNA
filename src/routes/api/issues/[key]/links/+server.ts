import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	issueParams,
	linkBody,
	linkResponse,
} from "#lib/server/issues/schemas.ts";
import { linkIssue } from "#lib/server/issues/service.ts";

export const POST = endpoint(
	{
		params: issueParams,
		body: linkBody,
		response: { 201: linkResponse, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await linkIssue(actor, params.key, body),
	}),
);
