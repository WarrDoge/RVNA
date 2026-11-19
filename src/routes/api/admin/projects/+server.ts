import { z } from "zod";
import {
	adminProjectSchema,
	createAdminProject,
	createBody,
	listAdminProjects,
	listQuery,
} from "#lib/server/admin/projects.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		auth: "admin",
		query: listQuery,
		response: z.array(adminProjectSchema),
	},
	async ({ actor, query }) => listAdminProjects(actor, query),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: createBody,
		response: { 201: adminProjectSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createAdminProject(actor, body),
	}),
);
