import {
	deletePriority,
	idParams,
	migrateQuery,
	priorityRowSchema,
	priorityUpdateBody,
	updatePriority,
} from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PATCH = endpoint(
	{
		auth: "admin",
		params: idParams,
		body: priorityUpdateBody,
		response: { 200: priorityRowSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updatePriority(actor, params.id, body),
);

export const DELETE = endpoint(
	{
		auth: "admin",
		params: idParams,
		query: migrateQuery,
		response: { 400: errorSchema },
	},
	async ({ actor, params, query }) => {
		await deletePriority(actor, params.id, query);
		return { status: 204 };
	},
);
