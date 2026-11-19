import { endpoint } from "#lib/server/http.ts";
import { homeSchema } from "#lib/server/wiki/schemas.ts";
import { wikiHome } from "#lib/server/wiki/service.ts";

export const GET = endpoint({ response: homeSchema }, async ({ actor }) =>
	wikiHome(actor),
);
