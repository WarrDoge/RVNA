import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { pageParams, pageRefSchema } from "#lib/server/wiki/schemas.ts";
import { getPageChildren } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: pageParams, response: z.array(pageRefSchema) },
	async ({ actor, params }) => getPageChildren(actor, params.id),
);
