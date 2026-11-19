import { z } from "zod";
import {
	boardConfigSchema,
	boardCreateBody,
	boardListEntrySchema,
} from "#lib/server/agile/schemas.ts";
import { createBoard, listBoards } from "#lib/server/agile/service.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ response: z.array(boardListEntrySchema) },
	async ({ actor }) => listBoards(actor),
);

export const POST = endpoint(
	{
		body: boardCreateBody,
		response: { 201: boardConfigSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createBoard(actor, body),
	}),
);
