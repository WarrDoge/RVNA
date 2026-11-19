import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { profileSchema, userProfile } from "#lib/server/profile.ts";

export const GET = endpoint(
	{
		params: z.object({ username: z.string().min(1) }),
		response: profileSchema,
	},
	async ({ actor, params }) => userProfile(actor, params.username),
);
