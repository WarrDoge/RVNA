import {
	sprintCompleteBody,
	sprintCompleteSchema,
	sprintParams,
} from "#lib/server/agile/schemas.ts";
import { completeSprint } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		params: sprintParams,
		body: sprintCompleteBody,
		response: { 200: sprintCompleteSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => completeSprint(actor, params.id, body),
);
