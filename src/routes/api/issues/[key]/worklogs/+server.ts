import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	issueParams,
	worklogBody,
	worklogResponse,
	worklogsResponse,
} from "#lib/server/issues/schemas.ts";
import { addWorklog, listWorklogs } from "#lib/server/issues/service.ts";

export const GET = endpoint(
	{ params: issueParams, response: worklogsResponse },
	async ({ actor, params }) => listWorklogs(actor, params.key),
);

export const POST = endpoint(
	{
		params: issueParams,
		body: worklogBody,
		response: { 201: worklogResponse, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await addWorklog(actor, params.key, body),
	}),
);
