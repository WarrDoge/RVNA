import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { pageRefSchema, spaceParams } from "#lib/server/wiki/schemas.ts";
import { getSpaceTree } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: spaceParams, response: z.array(pageRefSchema) },
	async ({ actor, params }) => getSpaceTree(actor, params.key),
);
