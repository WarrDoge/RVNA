import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import {
	addActorBody,
	addRoleActor,
	roleParams,
	roleSchema,
} from "#lib/server/project-roles/service.ts";

export const POST = endpoint(
	{
		params: roleParams,
		body: addActorBody,
		response: z.object({ role: roleSchema }),
	},
	async ({ actor, params, body }) => {
		const result = await addRoleActor(actor, params.key, params.roleId, body);
		return {
			status: result.created ? 201 : 200,
			body: { role: result.role },
		};
	},
);
