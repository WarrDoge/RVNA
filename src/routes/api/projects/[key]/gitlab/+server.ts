import {
	getProjectGitlab,
	projectGitlabBody,
	projectGitlabSchema,
	projectParams,
	updateProjectGitlab,
} from "#lib/server/gitlab/routes.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", params: projectParams, response: projectGitlabSchema },
	async ({ actor, params }) => getProjectGitlab(actor, params.key),
);

export const PATCH = endpoint(
	{
		auth: "admin",
		params: projectParams,
		body: projectGitlabBody,
		response: projectGitlabSchema,
	},
	async ({ actor, params, body }) =>
		updateProjectGitlab(actor, params.key, body),
);
