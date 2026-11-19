import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { legacyResponse } from "#lib/server/legacy/http.ts";
import { quickSearch } from "#lib/server/legacy/service.ts";

const query = z.object({
	searchString: z.string().max(1000).optional(),
	searchStringEnc: z.string().max(4000).optional(),
});

export const GET = endpoint({ query, auth: "none" }, async ({ event, query }) =>
	legacyResponse(event, await quickSearch(event.locals.user, query)),
);
