import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { diffQuery, pageParams } from "#lib/server/wiki/schemas.ts";
import { diffPageVersions } from "#lib/server/wiki/service.ts";

const diffSchema = z.object({
	from: z.number().int(),
	to: z.number().int(),
	blocks: z.array(
		z.object({
			type: z.enum(["equal", "change"]),
			html: z.string(),
		}),
	),
});

export const GET = endpoint(
	{ params: pageParams, query: diffQuery, response: diffSchema },
	async ({ actor, params, query }) =>
		diffPageVersions(actor, params.id, query.from, query.to),
);
