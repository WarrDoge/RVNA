import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { SESSION_COOKIE, sessionCookieOptions } from "#lib/server/auth.ts";
import { endpoint } from "#lib/server/http.ts";
import { changePassword } from "#lib/server/local-auth.ts";

const body = z.object({
	currentPassword: z.string().max(1024),
	newPassword: z.string().max(1024),
});

export const POST = endpoint(
	{ body, response: { 204: z.void(), 400: errorSchema } },
	async ({ actor, body, event }) => {
		const session = await changePassword(actor, {
			...body,
			ip: event.getClientAddress(),
			sessionId: event.cookies.get(SESSION_COOKIE),
		});
		if (session) {
			event.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
		}
		return { status: 204 };
	},
);
