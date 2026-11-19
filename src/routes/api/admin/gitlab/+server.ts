import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	getGitlabSettings,
	gitlabBaseUrlBody,
	gitlabSettingsSchema,
	saveGitlabBaseUrl,
} from "#lib/server/gitlab/routes.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: gitlabSettingsSchema },
	async ({ actor }) => getGitlabSettings(actor),
);

export const PUT = endpoint(
	{
		auth: "admin",
		body: gitlabBaseUrlBody,
		response: { 200: gitlabSettingsSchema, 400: errorSchema },
	},
	async ({ actor, body }) => saveGitlabBaseUrl(actor, body),
);
