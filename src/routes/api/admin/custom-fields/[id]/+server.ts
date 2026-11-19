import { z } from "zod";
import {
	deleteCustomField,
	fieldParams,
	getCustomField,
	migrateQuery,
	updateCustomField,
	updateFieldBody,
} from "#lib/server/admin/fields.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { adminCustomFieldDetailSchema } from "#lib/server/custom-fields.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		auth: "admin",
		params: fieldParams,
		response: adminCustomFieldDetailSchema,
	},
	async ({ actor, params }) => getCustomField(actor, params.id),
);

export const PATCH = endpoint(
	{
		auth: "admin",
		params: fieldParams,
		body: updateFieldBody,
		response: { 200: adminCustomFieldDetailSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateCustomField(actor, params.id, body),
);

export const DELETE = endpoint(
	{
		auth: "admin",
		params: fieldParams,
		query: migrateQuery,
		response: { 204: z.void(), 400: errorSchema },
	},
	async ({ actor, params, query }) => {
		await deleteCustomField(actor, params.id, query);
		return { status: 204 };
	},
);
