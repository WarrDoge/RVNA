import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { pageLinkSchema, recentQuery } from "#lib/server/wiki/schemas.ts";
import { recentPages } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ query: recentQuery, response: z.array(pageLinkSchema) },
	async ({ actor, query }) => recentPages(actor, query),
);
