import {
	boardParams,
	sprintCreateBody,
	sprintSchema,
} from "#lib/server/agile/schemas.ts";
import { createSprint } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		params: boardParams,
		body: sprintCreateBody,
		response: { 201: sprintSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => ({
		status: 201,
		body: await createSprint(actor, params.rapidViewId, body),
	}),
);
