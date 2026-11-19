import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { legacyResponse } from "#lib/server/legacy/http.ts";
import { attachmentRedirect } from "#lib/server/legacy/service.ts";

const params = z.object({
	sourceId: z.string().min(1).max(64),
	fileName: z.string().min(1).max(512),
});

export const GET = endpoint(
	{ params, auth: "none" },
	async ({ event, params }) =>
		legacyResponse(
			event,
			await attachmentRedirect(event.locals.user, params.sourceId),
		),
);
