import { z } from "zod";
import {
	listPermissionSchemes,
	schemeSchema,
} from "#lib/server/admin/permission-schemes.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.object({ schemes: z.array(schemeSchema) }) },
	async ({ actor }) => listPermissionSchemes(actor),
);
