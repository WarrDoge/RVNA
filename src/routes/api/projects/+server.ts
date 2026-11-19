import { z } from "zod";
import { projectSummarySchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import { listProjects } from "#lib/server/projects/service.ts";

export const GET = endpoint(
	{ response: z.array(projectSummarySchema) },
	async ({ actor }) => listProjects(actor),
);
