import { endpoint } from "#lib/server/http.ts";
import {
	actorParams,
	removeRoleActor,
} from "#lib/server/project-roles/service.ts";

export const DELETE = endpoint(
	{ params: actorParams },
	async ({ actor, params }) => {
		await removeRoleActor(actor, params.key, params.roleId, params.actorId);
		return { status: 204 };
	},
);
