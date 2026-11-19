import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { projectParams } from "#lib/server/reports/schemas.ts";
import { listProjectReleases } from "#lib/server/reports/service.ts";

export const GET = endpoint(
	{ params: projectParams, response: z.any() },
	async ({ actor, params }) => listProjectReleases(actor, params.key),
);
