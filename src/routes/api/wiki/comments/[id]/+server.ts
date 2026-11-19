import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	commentParams,
	commentSchema,
	updateCommentBody,
} from "#lib/server/wiki/schemas.ts";
import { deleteComment, updateComment } from "#lib/server/wiki/service.ts";

export const PATCH = endpoint(
	{
		params: commentParams,
		body: updateCommentBody,
		response: { 200: commentSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		updateComment(actor, params.id, body.bodyHtml),
);

export const DELETE = endpoint(
	{ params: commentParams },
	async ({ actor, params }) => {
		await deleteComment(actor, params.id);
		return { status: 204 };
	},
);
