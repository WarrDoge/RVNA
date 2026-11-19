import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { labelNameParams, pageLinkSchema } from "#lib/server/wiki/schemas.ts";
import { deleteLabel, pagesByLabel } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: labelNameParams, response: z.array(pageLinkSchema) },
	async ({ actor, params }) => pagesByLabel(actor, params.name),
);

export const DELETE = endpoint(
	{ params: z.object({ name: z.uuid() }) },
	async ({ actor, params }) => {
		await deleteLabel(actor, params.name);
		return { status: 204 };
	},
);
