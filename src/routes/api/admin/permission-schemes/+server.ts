import { z } from "zod";
import {
	createBody,
	createPermissionScheme,
	listPermissionSchemes,
	schemeSchema,
} from "#lib/server/admin/permission-schemes.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.object({ schemes: z.array(schemeSchema) }) },
	async ({ actor }) => listPermissionSchemes(actor),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: createBody,
		response: { 201: z.object({ scheme: schemeSchema }), 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createPermissionScheme(actor, body),
	}),
);
