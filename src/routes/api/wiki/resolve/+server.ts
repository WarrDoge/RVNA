import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import { resolveQuery, resolveSchema } from "#lib/server/wiki/schemas.ts";
import { resolvePage } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ query: resolveQuery, response: { 200: resolveSchema, 400: errorSchema } },
	async ({ actor, query }) => resolvePage(actor, query),
);
