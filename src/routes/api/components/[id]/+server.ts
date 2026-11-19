import { componentSchema, errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	componentParams,
	deleteComponent,
	updateComponent,
	updateComponentBody,
} from "#lib/server/projects/service.ts";

export const PATCH = endpoint(
	{
		params: componentParams,
		body: updateComponentBody,
		response: { 200: componentSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateComponent(actor, params.id, body),
);

export const DELETE = endpoint(
	{ params: componentParams },
	async ({ actor, params }) => {
		await deleteComponent(actor, params.id);
		return { status: 204 };
	},
);
