import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	clearGitlabAccessToken,
	gitlabSettingsSchema,
	gitlabTokenBody,
	saveGitlabAccessToken,
} from "#lib/server/gitlab/routes.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{
		auth: "admin",
		body: gitlabTokenBody,
		response: { 200: gitlabSettingsSchema, 400: errorSchema },
	},
	async ({ actor, body }) => saveGitlabAccessToken(actor, body),
);

export const DELETE = endpoint(
	{ auth: "admin", response: gitlabSettingsSchema },
	async ({ actor }) => clearGitlabAccessToken(actor),
);
