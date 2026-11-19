import { endpoint } from "#lib/server/http.ts";
import { portalListSchema } from "#lib/server/servicedesk/schemas.ts";
import { listPortals } from "#lib/server/servicedesk/service.ts";

export const GET = endpoint({ response: portalListSchema }, async ({ actor }) =>
	listPortals(actor),
);
