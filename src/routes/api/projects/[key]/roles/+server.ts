import { endpoint } from "#lib/server/http.ts";
import {
	getProjectRoles,
	projectParams,
	rolesResponse,
} from "#lib/server/project-roles/service.ts";

export const GET = endpoint(
	{ params: projectParams, response: rolesResponse },
	async ({ actor, params }) => getProjectRoles(actor, params.key),
);
