import {
	idParams,
	publishBody,
	publishResultSchema,
	publishWorkflow,
} from "#lib/server/admin/workflows.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		auth: "admin",
		params: idParams,
		body: publishBody,
		response: publishResultSchema,
	},
	async ({ actor, params, body }) => publishWorkflow(actor, params.id, body),
);
