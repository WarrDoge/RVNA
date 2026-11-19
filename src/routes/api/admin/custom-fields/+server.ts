import { z } from "zod";
import {
	createCustomField,
	createFieldBody,
	listCustomFields,
} from "#lib/server/admin/fields.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	adminCustomFieldDetailSchema,
	adminCustomFieldSummarySchema,
} from "#lib/server/custom-fields.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.array(adminCustomFieldSummarySchema) },
	async ({ actor }) => listCustomFields(actor),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: createFieldBody,
		response: { 201: adminCustomFieldDetailSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createCustomField(actor, body),
	}),
);
