import { z } from "zod";
import {
	fieldParams,
	reorderCustomFieldOptions,
	reorderOptionsBody,
} from "#lib/server/admin/fields.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { customFieldOptionSchema } from "#lib/server/custom-fields.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{
		auth: "admin",
		params: fieldParams,
		body: reorderOptionsBody,
		response: { 200: z.array(customFieldOptionSchema), 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		reorderCustomFieldOptions(actor, params.id, body),
);
