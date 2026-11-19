import {
	adminUserDetailSchema,
	getUser,
	updateUser,
	userParams,
	userResponseSchema,
	userUpdateBody,
} from "#lib/server/admin/users.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", params: userParams, response: adminUserDetailSchema },
	async ({ actor, params }) => getUser(actor, params.id),
);

export const PATCH = endpoint(
	{
		auth: "admin",
		params: userParams,
		body: userUpdateBody,
		response: { 200: userResponseSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateUser(actor, params.id, body),
);
