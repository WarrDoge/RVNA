import { z } from "zod";
import {
	addPermissionGrant,
	createGrantBody,
	grantSchema,
	schemeParams,
} from "#lib/server/admin/permission-schemes.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		auth: "admin",
		params: schemeParams,
		body: createGrantBody,
		response: { 201: z.object({ grant: grantSchema }), 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await addPermissionGrant(actor, params.id, body),
	}),
);
