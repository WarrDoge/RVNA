import {
	deleteWorkflow,
	detailQuery,
	detailSchema,
	getWorkflow,
	idParams,
	summarySchema,
	updateWorkflow,
	updateWorkflowBody,
} from "#lib/server/admin/workflows.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		auth: "admin",
		params: idParams,
		query: detailQuery,
		response: detailSchema,
	},
	async ({ actor, params, query }) => getWorkflow(actor, params.id, query),
);

export const PATCH = endpoint(
	{
		auth: "admin",
		params: idParams,
		body: updateWorkflowBody,
		response: summarySchema,
	},
	async ({ actor, params, body }) => updateWorkflow(actor, params.id, body),
);

export const DELETE = endpoint(
	{ auth: "admin", params: idParams },
	async ({ actor, params }) => {
		await deleteWorkflow(actor, params.id);
		return { status: 204 };
	},
);
