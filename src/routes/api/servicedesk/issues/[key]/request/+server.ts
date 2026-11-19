import { endpoint } from "#lib/server/http.ts";
import {
	issueParams,
	requestPanelSchema,
} from "#lib/server/servicedesk/schemas.ts";
import { issueRequestPanel } from "#lib/server/servicedesk/service.ts";

export const GET = endpoint(
	{ params: issueParams, response: requestPanelSchema },
	async ({ actor, params }) => issueRequestPanel(actor, params.key),
);
