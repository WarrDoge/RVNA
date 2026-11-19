import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { recentIssues, recentSchema } from "#lib/server/navigator/service.ts";

const recentQuery = z.object({
	limit: z.coerce.number().int().min(1).max(50).default(5),
});

export const GET = endpoint(
	{ query: recentQuery, response: recentSchema },
	async ({ actor, query }) => recentIssues(actor, query.limit),
);
