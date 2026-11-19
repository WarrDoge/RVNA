import {
	groupDetailResponseSchema,
	memberParams,
	removeGroupMember,
} from "#lib/server/admin/groups.ts";
import { endpoint } from "#lib/server/http.ts";

export const DELETE = endpoint(
	{ auth: "admin", params: memberParams, response: groupDetailResponseSchema },
	async ({ actor, params }) =>
		removeGroupMember(actor, params.id, params.userId),
);
