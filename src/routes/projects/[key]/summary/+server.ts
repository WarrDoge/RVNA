import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { projectPageResponse } from "#lib/server/project-keys/http.ts";

const params = z.object({ key: z.string().min(1) });

export const GET = endpoint(
	{ params, auth: "none" },
	async ({ event, params }) => projectPageResponse(event, params.key),
);
