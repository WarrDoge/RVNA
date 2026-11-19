import {
	createdUserResponseSchema,
	createUser,
	listUsers,
	userCreateBody,
	userListQuery,
	userListResponseSchema,
} from "#lib/server/admin/users.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", query: userListQuery, response: userListResponseSchema },
	async ({ actor, query }) => listUsers(actor, query),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: userCreateBody,
		response: { 201: createdUserResponseSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createUser(actor, body),
	}),
);
