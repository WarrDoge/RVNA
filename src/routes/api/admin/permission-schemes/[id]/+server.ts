import {
	getPermissionScheme,
	schemeDetailSchema,
	schemeParams,
} from "#lib/server/admin/permission-schemes.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", params: schemeParams, response: schemeDetailSchema },
	async ({ actor, params }) => getPermissionScheme(actor, params.id),
);
