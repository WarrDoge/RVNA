import { z } from "zod";
import {
	createPriority,
	listPriorities,
	priorityCreateBody,
	priorityRowSchema,
} from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.array(priorityRowSchema) },
	async ({ actor }) => listPriorities(actor),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: priorityCreateBody,
		response: { 201: priorityRowSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createPriority(actor, body),
	}),
);
