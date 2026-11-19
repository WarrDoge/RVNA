import { z } from "zod";
import {
	assignBody,
	assignPermissionSchemeProject,
	schemeParams,
	schemeSchema,
} from "#lib/server/admin/permission-schemes.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		auth: "admin",
		params: schemeParams,
		body: assignBody,
		response: z.object({ scheme: schemeSchema }),
	},
	async ({ actor, params, body }) =>
		assignPermissionSchemeProject(actor, params.id, body),
);
