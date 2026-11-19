import { z } from "zod";
import {
	createWorkflow,
	createWorkflowBody,
	listWorkflows,
	summarySchema,
} from "#lib/server/admin/workflows.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.array(summarySchema) },
	async ({ actor }) => listWorkflows(actor),
);

export const POST = endpoint(
	{ auth: "admin", body: createWorkflowBody, response: summarySchema },
	async ({ actor, body }) => ({
		status: 201,
		body: await createWorkflow(actor, body),
	}),
);
