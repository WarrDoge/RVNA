import {
	deleteLinkType,
	idParams,
	linkTypeRowSchema,
	linkTypeUpdateBody,
	migrateQuery,
	updateLinkType,
} from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PATCH = endpoint(
	{
		auth: "admin",
		params: idParams,
		body: linkTypeUpdateBody,
		response: { 200: linkTypeRowSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateLinkType(actor, params.id, body),
);

export const DELETE = endpoint(
	{
		auth: "admin",
		params: idParams,
		query: migrateQuery,
		response: { 400: errorSchema },
	},
	async ({ actor, params, query }) => {
		await deleteLinkType(actor, params.id, query);
		return { status: 204 };
	},
);
