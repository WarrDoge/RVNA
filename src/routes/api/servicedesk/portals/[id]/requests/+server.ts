import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	createdRequestSchema,
	createRequestSchema,
	portalParams,
} from "#lib/server/servicedesk/schemas.ts";
import { createPortalRequest } from "#lib/server/servicedesk/service.ts";

export const POST = endpoint(
	{
		params: portalParams,
		body: createRequestSchema,
		response: { 201: createdRequestSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await createPortalRequest(actor, params.id, body),
	}),
);
