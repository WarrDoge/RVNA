import type { RequestEvent } from "@sveltejs/kit";
import { loginPath } from "../auth.ts";
import { HttpError } from "../http.ts";
import type { LegacyOutcome } from "./service.ts";

/** The old Jira page addresses answer a redirect, or the route's error: 404 when no redirect applies. */
export async function legacyResponse(
	event: RequestEvent,
	outcome: LegacyOutcome,
): Promise<Response> {
	switch (outcome.kind) {
		case "login":
			return new Response(null, {
				status: 302,
				headers: {
					location: loginPath(`${event.url.pathname}${event.url.search}`),
				},
			});
		case "redirect":
			return new Response(null, {
				status: 302,
				headers: { location: outcome.location },
			});
		case "none":
			throw new HttpError(404, "Not found");
		case "error":
			throw new HttpError(outcome.status, outcome.message);
	}
}
