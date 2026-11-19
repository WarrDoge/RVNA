import { z } from "zod";
import {
	deleteCustomFieldOption,
	migrateQuery,
	optionParams,
	updateCustomFieldOption,
	updateOptionBody,
} from "#lib/server/admin/fields.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { customFieldOptionSchema } from "#lib/server/custom-fields.ts";
import { endpoint } from "#lib/server/http.ts";

export const PATCH = endpoint(
	{
		auth: "admin",
		params: optionParams,
		body: updateOptionBody,
		response: { 200: customFieldOptionSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		updateCustomFieldOption(actor, params.id, params.optionId, body),
);

export const DELETE = endpoint(
	{
		auth: "admin",
		params: optionParams,
		query: migrateQuery,
		response: { 204: z.void(), 400: errorSchema },
	},
	async ({ actor, params, query }) => {
		await deleteCustomFieldOption(actor, params.id, params.optionId, query);
		return { status: 204 };
	},
);
