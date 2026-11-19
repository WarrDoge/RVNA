import type { RequestEvent } from "@sveltejs/kit";
import { HttpError } from "../http.ts";
import { projectPage } from "./service.ts";

/** A project page redirect, or 404 when no redirect applies. */
export async function projectPageResponse(
	event: RequestEvent,
	resolvedKey: string,
): Promise<Response> {
	const outcome = await projectPage(event.locals.user, {
		pathname: event.url.pathname,
		search: event.url.search,
		resolvedKey,
	});
	if (outcome.kind === "none") throw new HttpError(404, "Not found");
	return new Response(null, {
		status: 302,
		headers: { location: outcome.location },
	});
}
