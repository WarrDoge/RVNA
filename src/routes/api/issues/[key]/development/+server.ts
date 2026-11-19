import {
	developmentSchema,
	getIssueDevelopment,
	issueParams,
} from "#lib/server/gitlab/routes.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ params: issueParams, response: developmentSchema },
	async ({ actor, params }) => getIssueDevelopment(actor, params.key),
);
