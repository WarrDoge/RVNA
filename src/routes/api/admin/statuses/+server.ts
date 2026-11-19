import { z } from "zod";
import {
	createStatus,
	listStatuses,
	statusCreateBody,
	statusRowSchema,
} from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.array(statusRowSchema) },
	async ({ actor }) => listStatuses(actor),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: statusCreateBody,
		response: { 201: statusRowSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createStatus(actor, body),
	}),
);
