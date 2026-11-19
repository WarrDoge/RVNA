import { endpoint } from "#lib/server/http.ts";
import { issueParams, watchResponse } from "#lib/server/issues/schemas.ts";
import { unwatchIssue, watchIssue } from "#lib/server/issues/service.ts";

export const PUT = endpoint(
	{ params: issueParams, response: watchResponse },
	async ({ actor, params }) => watchIssue(actor, params.key),
);

export const DELETE = endpoint(
	{ params: issueParams, response: watchResponse },
	async ({ actor, params }) => unwatchIssue(actor, params.key),
);
