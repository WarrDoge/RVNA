import {
	deleteStatus,
	idParams,
	migrateQuery,
	statusRowSchema,
	statusUpdateBody,
	updateStatus,
} from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PATCH = endpoint(
	{
		auth: "admin",
		params: idParams,
		body: statusUpdateBody,
		response: { 200: statusRowSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateStatus(actor, params.id, body),
);

export const DELETE = endpoint(
	{
		auth: "admin",
		params: idParams,
		query: migrateQuery,
		response: { 400: errorSchema },
	},
	async ({ actor, params, query }) => {
		await deleteStatus(actor, params.id, query);
		return { status: 204 };
	},
);
