import { definitionSchema } from "#lib/server/admin/workflow-definition.ts";
import {
	detailSchema,
	discardWorkflowDraft,
	idParams,
	saveWorkflowDraft,
} from "#lib/server/admin/workflows.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{
		auth: "admin",
		params: idParams,
		body: definitionSchema,
		response: { 200: detailSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => saveWorkflowDraft(actor, params.id, body),
);

export const DELETE = endpoint(
	{ auth: "admin", params: idParams },
	async ({ actor, params }) => {
		await discardWorkflowDraft(actor, params.id);
		return { status: 204 };
	},
);
