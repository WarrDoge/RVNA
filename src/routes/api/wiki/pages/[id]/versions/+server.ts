import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { pageParams, pageVersionSchema } from "#lib/server/wiki/schemas.ts";
import { listPageVersions } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: pageParams, response: z.array(pageVersionSchema) },
	async ({ actor, params }) => listPageVersions(actor, params.id),
);
