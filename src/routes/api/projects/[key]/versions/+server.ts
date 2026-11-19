import { errorSchema, versionSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	createVersion,
	createVersionBody,
	projectParams,
} from "#lib/server/projects/service.ts";

export const POST = endpoint(
	{
		params: projectParams,
		body: createVersionBody,
		response: { 201: versionSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await createVersion(actor, params.key, body),
	}),
);
