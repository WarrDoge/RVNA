import { projectIssueListSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	listProjectIssues,
	projectIssuesQuery,
	projectParams,
} from "#lib/server/projects/service.ts";

export const GET = endpoint(
	{
		params: projectParams,
		query: projectIssuesQuery,
		response: projectIssueListSchema,
	},
	async ({ actor, params, query }) =>
		listProjectIssues(actor, params.key, query),
);
