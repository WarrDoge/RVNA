import {
	deleteResolution,
	idParams,
	migrateQuery,
	resolutionRowSchema,
	resolutionUpdateBody,
	updateResolution,
} from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PATCH = endpoint(
	{
		auth: "admin",
		params: idParams,
		body: resolutionUpdateBody,
		response: { 200: resolutionRowSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateResolution(actor, params.id, body),
);

export const DELETE = endpoint(
	{
		auth: "admin",
		params: idParams,
		query: migrateQuery,
		response: { 400: errorSchema },
	},
	async ({ actor, params, query }) => {
		await deleteResolution(actor, params.id, query);
		return { status: 204 };
	},
);
