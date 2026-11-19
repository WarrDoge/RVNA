import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import {
	gadgetParams,
	gadgetPatchBody,
	gadgetSchema,
} from "#lib/server/dashboards/schemas.ts";
import { removeGadget, updateGadget } from "#lib/server/dashboards/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const PATCH = endpoint(
	{
		params: gadgetParams,
		body: gadgetPatchBody,
		response: { 200: gadgetSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => updateGadget(actor, params.id, body),
);

export const DELETE = endpoint(
	{ params: gadgetParams, response: z.void() },
	async ({ actor, params }) => {
		await removeGadget(actor, params.id);
		return { status: 204 };
	},
);
