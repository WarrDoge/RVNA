import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	bodySchema,
	createFilter,
	filterSchema,
	listFilters,
	listQuery,
} from "#lib/server/filters/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ query: listQuery, response: z.array(filterSchema) },
	async ({ actor, query }) => listFilters(actor, query),
);

export const POST = endpoint(
	{ body: bodySchema, response: { 201: filterSchema, 400: errorSchema } },
	async ({ actor, body }) => ({
		status: 201,
		body: await createFilter(actor, body),
	}),
);
