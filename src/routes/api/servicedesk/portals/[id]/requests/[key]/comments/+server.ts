import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	commentBodySchema,
	commentCreatedSchema,
	requestParams,
} from "#lib/server/servicedesk/schemas.ts";
import { addPortalComment } from "#lib/server/servicedesk/service.ts";

export const POST = endpoint(
	{
		params: requestParams,
		body: commentBodySchema,
		response: { 201: commentCreatedSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await addPortalComment(actor, params.id, params.key, body.body),
	}),
);
