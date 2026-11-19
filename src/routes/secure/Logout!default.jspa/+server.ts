import { SESSION_COOKIE } from "#lib/server/auth.ts";
import { endpoint } from "#lib/server/http.ts";
import { legacyResponse } from "#lib/server/legacy/http.ts";
import { logout } from "#lib/server/legacy/service.ts";

export const GET = endpoint({ auth: "none" }, async ({ event }) => {
	const outcome = await logout(
		event.locals.user,
		event.cookies.get(SESSION_COOKIE),
	);
	if (outcome.kind === "redirect") {
		event.cookies.delete(SESSION_COOKIE, { path: "/" });
	}
	return legacyResponse(event, outcome);
});
