import { z } from "zod";
import { clearCookieOptions, SESSION_COOKIE } from "#lib/server/auth.ts";
import { db } from "#lib/server/db.ts";
import { endpoint } from "#lib/server/http.ts";
import { recordAudit } from "#lib/server/local-auth.ts";
import { logout } from "#lib/server/oidc.ts";

const response = z.object({ redirect: z.string() });

export const POST = endpoint({ auth: "none", response }, async ({ event }) => {
	const actor = event.locals.user;
	try {
		return await logout(event.cookies.get(SESSION_COOKIE));
	} finally {
		event.cookies.set(SESSION_COOKIE, "", clearCookieOptions("/"));
		if (actor) {
			await recordAudit(db, {
				actorId: actor.id,
				actorName: actor.displayName,
				action: "auth.logout",
				entityType: "user",
				entityId: actor.id,
				summary: `${actor.username} logged out from ${event.getClientAddress()}`,
			});
		}
	}
});
