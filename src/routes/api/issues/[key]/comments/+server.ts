import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	commentBody,
	commentResponse,
	commentsResponse,
	issueParams,
} from "#lib/server/issues/schemas.ts";
import { addComment, listComments } from "#lib/server/issues/service.ts";

export const GET = endpoint(
	{ params: issueParams, response: commentsResponse },
	async ({ actor, params }) => listComments(actor, params.key),
);

export const POST = endpoint(
	{
		params: issueParams,
		body: commentBody,
		response: { 201: commentResponse, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await addComment(actor, params.key, body),
	}),
);
