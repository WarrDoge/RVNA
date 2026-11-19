import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { searchUsers, userListSchema } from "#lib/server/users.ts";

const query = z.object({
	query: z.string().trim().max(200).default(""),
});

export const GET = endpoint(
	{ query, response: userListSchema },
	async ({ actor, query }) => searchUsers(actor, query.query),
);
