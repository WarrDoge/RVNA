import {
	sprintParams,
	sprintSchema,
	sprintStartBody,
} from "#lib/server/agile/schemas.ts";
import { startSprint } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		params: sprintParams,
		body: sprintStartBody,
		response: { 200: sprintSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => startSprint(actor, params.id, body),
);
