import { z } from "zod";
import {
	sprintParams,
	sprintPatchBody,
	sprintSchema,
} from "#lib/server/agile/schemas.ts";
import { deleteSprint, updateSprint } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PATCH = endpoint(
	{
		params: sprintParams,
		body: sprintPatchBody,
		response: { 200: sprintSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateSprint(actor, params.id, body),
);

export const DELETE = endpoint(
	{ params: sprintParams, response: { 204: z.void(), 400: errorSchema } },
	async ({ actor, params }) => {
		await deleteSprint(actor, params.id);
		return { status: 204 };
	},
);
