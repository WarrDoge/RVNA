import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { pageParams } from "#lib/server/wiki/schemas.ts";
import { getPageAncestors } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{
		params: pageParams,
		response: z.array(
			z.object({ id: z.uuid(), sourceId: z.string(), title: z.string() }),
		),
	},
	async ({ actor, params }) => getPageAncestors(actor, params.id),
);
