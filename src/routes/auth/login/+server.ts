import { z } from "zod";
import {
	SESSION_COOKIE,
	sessionCookieOptions,
	TRANSACTION_COOKIE,
	transactionCookieOptions,
} from "#lib/server/auth.ts";
import { endpoint } from "#lib/server/http.ts";
import { startLogin } from "#lib/server/oidc.ts";

const query = z.object({ returnTo: z.string().optional() });

export const GET = endpoint(
	{ auth: "none", query },
	async ({ query, event }) => {
		const result = await startLogin({
			returnTo: query.returnTo,
			ip: event.getClientAddress(),
		});
		if (result.kind === "session") {
			event.cookies.set(SESSION_COOKIE, result.session, sessionCookieOptions());
			return new Response(null, {
				status: 303,
				headers: { location: result.location },
			});
		}
		event.cookies.set(
			TRANSACTION_COOKIE,
			result.transactionId,
			transactionCookieOptions(),
		);
		return new Response(null, {
			status: 302,
			headers: { location: result.location },
		});
	},
);
