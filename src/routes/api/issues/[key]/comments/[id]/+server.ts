import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	commentParams,
	commentResponse,
	commentUpdateBody,
} from "#lib/server/issues/schemas.ts";
import { deleteComment, updateComment } from "#lib/server/issues/service.ts";

export const PATCH = endpoint(
	{
		params: commentParams,
		body: commentUpdateBody,
		response: { 200: commentResponse, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		updateComment(actor, params.key, params.id, body),
);

export const DELETE = endpoint(
	{ params: commentParams },
	async ({ actor, params }) => {
		await deleteComment(actor, params.key, params.id);
		return { status: 204 };
	},
);
