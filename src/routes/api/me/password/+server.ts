import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { SESSION_COOKIE } from "#lib/server/auth.ts";
import { endpoint } from "#lib/server/http.ts";
import { changePassword } from "#lib/server/local-auth.ts";

const body = z.object({
	currentPassword: z.string().max(1024),
	newPassword: z.string().max(1024),
});

export const POST = endpoint(
	{ body, response: { 204: z.void(), 400: errorSchema } },
	async ({ actor, body, event }) => {
		await changePassword(actor, {
			...body,
			ip: event.getClientAddress(),
			keepSessionId: event.cookies.get(SESSION_COOKIE),
		});
		return { status: 204 };
	},
);
