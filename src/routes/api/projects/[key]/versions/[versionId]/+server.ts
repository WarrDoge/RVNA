import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { versionParams } from "#lib/server/reports/schemas.ts";
import { getProjectVersion } from "#lib/server/reports/service.ts";

export const GET = endpoint(
	{ params: versionParams, response: z.any() },
	async ({ actor, params }) =>
		getProjectVersion(actor, params.key, params.versionId),
);
