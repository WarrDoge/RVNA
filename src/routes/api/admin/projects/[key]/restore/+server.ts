import {
	adminProjectSchema,
	projectParams,
	setAdminProjectArchived,
} from "#lib/server/admin/projects.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{ auth: "admin", params: projectParams, response: adminProjectSchema },
	async ({ actor, params }) =>
		setAdminProjectArchived(actor, params.key, false),
);
