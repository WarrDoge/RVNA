import { z } from "zod";
import {
	createResolution,
	listResolutions,
	resolutionCreateBody,
	resolutionRowSchema,
} from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.array(resolutionRowSchema) },
	async ({ actor }) => listResolutions(actor),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: resolutionCreateBody,
		response: { 201: resolutionRowSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createResolution(actor, body),
	}),
);
