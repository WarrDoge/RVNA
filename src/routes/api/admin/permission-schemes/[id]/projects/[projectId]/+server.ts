import {
	removePermissionSchemeProject,
	schemeProjectParams,
} from "#lib/server/admin/permission-schemes.ts";
import { endpoint } from "#lib/server/http.ts";

export const DELETE = endpoint(
	{ auth: "admin", params: schemeProjectParams },
	async ({ actor, params }) => {
		await removePermissionSchemeProject(actor, params.id, params.projectId);
		return { status: 204 };
	},
);
