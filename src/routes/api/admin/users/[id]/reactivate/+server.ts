import {
	reactivateUser,
	userParams,
	userResponseSchema,
} from "#lib/server/admin/users.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{ auth: "admin", params: userParams, response: userResponseSchema },
	async ({ actor, params }) => reactivateUser(actor, params.id),
);
