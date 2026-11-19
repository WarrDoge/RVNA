import { errorSchema, versionSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	deleteVersion,
	updateVersion,
	updateVersionBody,
	versionParams,
} from "#lib/server/projects/service.ts";

export const PATCH = endpoint(
	{
		params: versionParams,
		body: updateVersionBody,
		response: { 200: versionSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateVersion(actor, params.id, body),
);

export const DELETE = endpoint(
	{ params: versionParams },
	async ({ actor, params }) => {
		await deleteVersion(actor, params.id);
		return { status: 204 };
	},
);
