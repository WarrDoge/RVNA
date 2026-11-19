import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	createGitlabWebhookSecret,
	gitlabSecretSchema,
} from "#lib/server/gitlab/routes.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{ auth: "admin", response: { 200: gitlabSecretSchema, 400: errorSchema } },
	async ({ actor }) => createGitlabWebhookSecret(actor),
);
