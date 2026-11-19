import { z } from "zod";
import {
	copyBody,
	copyPermissionScheme,
	schemeParams,
	schemeSchema,
} from "#lib/server/admin/permission-schemes.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		auth: "admin",
		params: schemeParams,
		body: copyBody,
		response: z.object({ scheme: schemeSchema }),
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await copyPermissionScheme(actor, params.id, body),
	}),
);
