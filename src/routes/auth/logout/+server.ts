import { z } from "zod";
import { clearCookieOptions, SESSION_COOKIE } from "#lib/server/auth.ts";
import { endpoint } from "#lib/server/http.ts";
import { logout } from "#lib/server/oidc.ts";

const response = z.object({ redirect: z.string() });

export const POST = endpoint({ auth: "none", response }, async ({ event }) => {
	try {
		return await logout(event.cookies.get(SESSION_COOKIE));
	} finally {
		event.cookies.set(SESSION_COOKIE, "", clearCookieOptions("/"));
	}
});
