import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	gitlabVersionSchema,
	testGitlabConnection,
} from "#lib/server/gitlab/routes.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{ auth: "admin", response: { 200: gitlabVersionSchema, 400: errorSchema } },
	async ({ actor }) => testGitlabConnection(actor),
);
