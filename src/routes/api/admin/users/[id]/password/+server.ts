import {
	createdUserResponseSchema,
	passwordBody,
	removeUserPassword,
	setUserPassword,
	userParams,
	userResponseSchema,
} from "#lib/server/admin/users.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		auth: "admin",
		params: userParams,
		body: passwordBody,
		response: { 200: createdUserResponseSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => setUserPassword(actor, params.id, body),
);

export const DELETE = endpoint(
	{ auth: "admin", params: userParams, response: userResponseSchema },
	async ({ actor, params }) => removeUserPassword(actor, params.id),
);
