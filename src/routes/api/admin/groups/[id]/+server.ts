import {
	deleteGroup,
	getGroup,
	groupDetailSchema,
	groupParams,
} from "#lib/server/admin/groups.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", params: groupParams, response: groupDetailSchema },
	async ({ actor, params }) => getGroup(actor, params.id),
);

export const DELETE = endpoint(
	{ auth: "admin", params: groupParams },
	async ({ actor, params }) => {
		await deleteGroup(actor, params.id);
		return { status: 204 };
	},
);
