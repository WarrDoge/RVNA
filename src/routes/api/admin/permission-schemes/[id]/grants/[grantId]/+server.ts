import {
	grantParams,
	removePermissionGrant,
} from "#lib/server/admin/permission-schemes.ts";
import { endpoint } from "#lib/server/http.ts";

export const DELETE = endpoint(
	{ auth: "admin", params: grantParams },
	async ({ actor, params }) => {
		await removePermissionGrant(actor, params.id, params.grantId);
		return { status: 204 };
	},
);
