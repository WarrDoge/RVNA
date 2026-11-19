import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { me } from "#lib/server/me/service.ts";

const schema = z.object({
	id: z.uuid(),
	username: z.string(),
	displayName: z.string(),
	email: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	groups: z.array(z.string()),
	isAdmin: z.boolean(),
	mustChangePassword: z.boolean(),
	hasPassword: z.boolean(),
});

export const GET = endpoint({ response: schema }, async ({ actor }) =>
	me(actor),
);
