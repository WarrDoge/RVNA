import { endpoint } from "#lib/server/http.ts";
import { worklogParams } from "#lib/server/issues/schemas.ts";
import { deleteWorklog } from "#lib/server/issues/service.ts";

export const DELETE = endpoint(
	{ params: worklogParams },
	async ({ actor, params }) => {
		await deleteWorklog(actor, params.key, params.id);
		return { status: 204 };
	},
);
