import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { legacyResponse } from "#lib/server/legacy/http.ts";
import { attachmentZip } from "#lib/server/legacy/service.ts";

const params = z.object({ issueId: z.string().min(1).max(64) });

export const GET = endpoint({ params, auth: "none" }, async ({ event }) =>
	legacyResponse(event, await attachmentZip(event.locals.user)),
);
