import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	commentSchema,
	createCommentBody,
	pageParams,
} from "#lib/server/wiki/schemas.ts";
import { createComment, listComments } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: pageParams, response: z.array(commentSchema) },
	async ({ actor, params }) => listComments(actor, params.id),
);

export const POST = endpoint(
	{
		params: pageParams,
		body: createCommentBody,
		response: { 201: commentSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await createComment(actor, params.id, body),
	}),
);
