import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	deleteFilter,
	filterParams,
	filterPatchSchema,
	filterSchema,
	getFilter,
	updateFilter,
} from "#lib/server/filters/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ params: filterParams, response: filterSchema },
	async ({ actor, params }) => getFilter(actor, params.id),
);

export const PATCH = endpoint(
	{
		params: filterParams,
		body: filterPatchSchema,
		response: { 200: filterSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateFilter(actor, params.id, body),
);

export const DELETE = endpoint(
	{ params: filterParams, response: z.void() },
	async ({ actor, params }) => {
		await deleteFilter(actor, params.id);
		return { status: 204 };
	},
);
