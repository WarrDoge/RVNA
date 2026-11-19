import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { templateSchema, templatesQuery } from "#lib/server/wiki/schemas.ts";
import { listTemplates } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ query: templatesQuery, response: z.array(templateSchema) },
	async ({ actor, query }) => listTemplates(actor, query.space),
);
