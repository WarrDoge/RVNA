import { z } from "zod";
import {
	contextsBody,
	fieldParams,
	setCustomFieldContexts,
} from "#lib/server/admin/fields.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { customFieldContextSchema } from "#lib/server/custom-fields.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{
		auth: "admin",
		params: fieldParams,
		body: contextsBody,
		response: { 200: z.array(customFieldContextSchema), 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		setCustomFieldContexts(actor, params.id, body),
);
