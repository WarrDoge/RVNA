import {
	holderParams,
	removeGlobalPermission,
} from "#lib/server/admin/global-permissions.ts";
import { endpoint } from "#lib/server/http.ts";

export const DELETE = endpoint(
	{ auth: "admin", params: holderParams },
	async ({ actor, params }) => {
		await removeGlobalPermission(actor, params.id);
		return { status: 204 };
	},
);
