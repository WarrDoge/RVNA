import {
	errorSchema,
	projectDetailSchema,
	projectSummarySchema,
} from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	getProject,
	projectParams,
	updateProject,
	updateProjectBody,
} from "#lib/server/projects/service.ts";

export const GET = endpoint(
	{ params: projectParams, response: projectDetailSchema },
	async ({ actor, params }) => getProject(actor, params.key),
);

export const PATCH = endpoint(
	{
		params: projectParams,
		body: updateProjectBody,
		response: { 200: projectSummarySchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateProject(actor, params.key, body),
);
