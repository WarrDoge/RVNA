import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	commentParams,
	commentSchema,
	resolveCommentBody,
} from "#lib/server/wiki/schemas.ts";
import { resolveComment } from "#lib/server/wiki/service.ts";

export const POST = endpoint(
	{
		params: commentParams,
		body: resolveCommentBody,
		response: { 200: commentSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		resolveComment(actor, params.id, body.resolved),
);
