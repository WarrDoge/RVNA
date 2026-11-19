import {
	addGroupMember,
	groupDetailResponseSchema,
	groupMemberBody,
	groupParams,
} from "#lib/server/admin/groups.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		auth: "admin",
		params: groupParams,
		body: groupMemberBody,
		response: groupDetailResponseSchema,
	},
	async ({ actor, params, body }) => addGroupMember(actor, params.id, body),
);
