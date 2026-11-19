import {
	deletePermissionScheme,
	getPermissionScheme,
	schemeDetailSchema,
	schemeParams,
} from "#lib/server/admin/permission-schemes.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", params: schemeParams, response: schemeDetailSchema },
	async ({ actor, params }) => getPermissionScheme(actor, params.id),
);

export const DELETE = endpoint(
	{ auth: "admin", params: schemeParams },
	async ({ actor, params }) => {
		await deletePermissionScheme(actor, params.id);
		return { status: 204 };
	},
);
