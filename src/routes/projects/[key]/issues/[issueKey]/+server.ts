import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { legacyResponse } from "#lib/server/legacy/http.ts";
import { projectIssueRedirect } from "#lib/server/legacy/service.ts";

const params = z.object({
	key: z.string().min(1).max(64),
	issueKey: z.string().min(1).max(64),
});

export const GET = endpoint(
	{ params, auth: "none" },
	async ({ event, params }) =>
		legacyResponse(
			event,
			await projectIssueRedirect(event.locals.user, params.issueKey),
		),
);
