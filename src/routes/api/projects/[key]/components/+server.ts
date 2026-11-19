import { componentSchema, errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	createComponent,
	createComponentBody,
	projectParams,
} from "#lib/server/projects/service.ts";

export const POST = endpoint(
	{
		params: projectParams,
		body: createComponentBody,
		response: { 201: componentSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await createComponent(actor, params.key, body),
	}),
);
