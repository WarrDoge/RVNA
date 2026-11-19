import {
	boardConfigSchema,
	boardParams,
	boardPatchBody,
} from "#lib/server/agile/schemas.ts";
import {
	deleteBoard,
	getBoard,
	updateBoard,
} from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ params: boardParams, response: boardConfigSchema },
	async ({ actor, params }) => getBoard(actor, params.rapidViewId),
);

export const PATCH = endpoint(
	{
		params: boardParams,
		body: boardPatchBody,
		response: { 200: boardConfigSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		updateBoard(actor, params.rapidViewId, body),
);

export const DELETE = endpoint(
	{ params: boardParams },
	async ({ actor, params }) => {
		await deleteBoard(actor, params.rapidViewId);
		return { status: 204 };
	},
);
