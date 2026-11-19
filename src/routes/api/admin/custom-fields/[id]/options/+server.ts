import {
	createCustomFieldOption,
	createOptionBody,
	fieldParams,
} from "#lib/server/admin/fields.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { customFieldOptionSchema } from "#lib/server/custom-fields.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		auth: "admin",
		params: fieldParams,
		body: createOptionBody,
		response: { 201: customFieldOptionSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await createCustomFieldOption(actor, params.id, body),
	}),
);
