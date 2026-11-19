import {
	assignmentBody,
	assignmentParams,
	assignmentResultSchema,
	assignmentSchema,
	getWorkflowAssignment,
	setWorkflowAssignment,
} from "#lib/server/admin/workflows.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		auth: "admin",
		params: assignmentParams,
		response: assignmentSchema,
	},
	async ({ actor, params }) => getWorkflowAssignment(actor, params.projectKey),
);

export const PUT = endpoint(
	{
		auth: "admin",
		params: assignmentParams,
		body: assignmentBody,
		response: { 200: assignmentResultSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		setWorkflowAssignment(actor, params.projectKey, body),
);
