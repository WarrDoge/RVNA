import { z } from "zod";
import {
	sprintMoveBody,
	sprintParams,
	sprintSchema,
} from "#lib/server/agile/schemas.ts";
import { moveSprint } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const POST = endpoint(
	{
		params: sprintParams,
		body: sprintMoveBody,
		response: { 200: z.array(sprintSchema), 400: errorSchema },
	},
	async ({ actor, params, body }) => moveSprint(actor, params.id, body),
);
