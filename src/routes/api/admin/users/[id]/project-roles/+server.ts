import { endpoint } from "#lib/server/http.ts";
import {
	getUserProjectRoles,
	userParams,
	userRolesResponse,
} from "#lib/server/project-roles/service.ts";

export const GET = endpoint(
	{ params: userParams, response: userRolesResponse, auth: "admin" },
	async ({ actor, params }) => getUserProjectRoles(actor, params.id),
);
