import { orderBody, reorderPriorities } from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{ auth: "admin", body: orderBody, response: { 400: errorSchema } },
	async ({ actor, body }) => {
		await reorderPriorities(actor, body);
		return { status: 204 };
	},
);
