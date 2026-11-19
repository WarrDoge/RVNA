import { endpoint } from "#lib/server/http.ts";
import { issueParams, slaSchema } from "#lib/server/servicedesk/schemas.ts";
import { deskIssueSla } from "#lib/server/servicedesk/service.ts";

export const GET = endpoint(
	{ params: issueParams, response: slaSchema },
	async ({ actor, params }) => deskIssueSla(actor, params.key),
);
