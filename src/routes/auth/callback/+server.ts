import { z } from "zod";
import {
	clearCookieOptions,
	SESSION_COOKIE,
	sessionCookieOptions,
	TRANSACTION_COOKIE,
} from "#lib/server/auth.ts";
import { endpoint } from "#lib/server/http.ts";
import { completeLogin, OidcCallbackError } from "#lib/server/oidc.ts";

const query = z.object({
	code: z.string().optional(),
	state: z.string().optional(),
	error: z.string().optional(),
});

export const GET = endpoint(
	{ auth: "none", query },
	async ({ query, event }) => {
		try {
			const result = await completeLogin({
				transactionId: event.cookies.get(TRANSACTION_COOKIE),
				code: query.code,
				state: query.state,
				error: query.error,
				url: event.url,
			});
			event.cookies.set(TRANSACTION_COOKIE, "", clearCookieOptions("/auth"));
			event.cookies.set(SESSION_COOKIE, result.session, sessionCookieOptions());
			return new Response(null, {
				status: 303,
				headers: { location: result.returnTo },
			});
		} catch (error) {
			if (error instanceof OidcCallbackError && error.clearTransaction) {
				event.cookies.set(TRANSACTION_COOKIE, "", clearCookieOptions("/auth"));
			}
			throw error;
		}
	},
);
