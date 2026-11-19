import { z } from "zod";
import {
	listWorkflowStatusOptions,
	statusSchema,
} from "#lib/server/admin/workflows.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.array(statusSchema) },
	async ({ actor }) => listWorkflowStatusOptions(actor),
);
