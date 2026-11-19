import { z } from "zod";
import { endpoint, HttpError, isBearer } from "#lib/server/http.ts";
import { compatIssue, issueParams } from "#lib/server/rest-compat/service.ts";

export const GET = endpoint(
	{
		params: issueParams,
		response: z.record(z.string(), z.unknown()),
		auth: "none",
		errors: "jira",
	},
	async ({ event, params }) => {
		const user = event.locals.user;
		if (!user || !isBearer(event.request)) {
			throw new HttpError(401, "You are not authenticated");
		}
		return compatIssue(user, params.key, event.url.origin);
	},
);
