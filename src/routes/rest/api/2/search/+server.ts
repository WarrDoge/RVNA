import { z } from "zod";
import { endpoint, HttpError, isBearer } from "#lib/server/http.ts";
import { compatSearch, searchQuery } from "#lib/server/rest-compat/service.ts";

export const GET = endpoint(
	{
		query: searchQuery,
		response: z.record(z.string(), z.unknown()),
		auth: "none",
		errors: "jira",
	},
	async ({ event, query }) => {
		const user = event.locals.user;
		if (!user || !isBearer(event.request)) {
			throw new HttpError(401, "You are not authenticated");
		}
		return compatSearch(user, query, event.url.origin);
	},
);
