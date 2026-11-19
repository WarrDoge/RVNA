import { z } from "zod";
import {
	getProjectCustomFields,
	projectCustomFieldsQuery,
	projectParams,
} from "#lib/server/custom-fields/service.ts";
import { customFieldDefinitionSchema } from "#lib/server/custom-fields.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		params: projectParams,
		query: projectCustomFieldsQuery,
		response: z.array(customFieldDefinitionSchema),
	},
	async ({ actor, params, query }) =>
		getProjectCustomFields(actor, params.key, query),
);
