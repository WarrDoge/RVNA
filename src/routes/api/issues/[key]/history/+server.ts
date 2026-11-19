import { endpoint } from "#lib/server/http.ts";
import { historyResponse, issueParams } from "#lib/server/issues/schemas.ts";
import { listHistory } from "#lib/server/issues/service.ts";

export const GET = endpoint(
	{ params: issueParams, response: historyResponse },
	async ({ actor, params }) => listHistory(actor, params.key),
);
