import { z } from "zod";
import {
	adminProjectSchema,
	deleteAdminProject,
	deleteBody,
	projectParams,
	updateAdminProject,
	updateBody,
} from "#lib/server/admin/projects.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const PATCH = endpoint(
	{
		auth: "admin",
		params: projectParams,
		body: updateBody,
		response: { 200: adminProjectSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) =>
		updateAdminProject(actor, params.key, body),
);

export const DELETE = endpoint(
	{
		auth: "admin",
		params: projectParams,
		body: deleteBody,
		response: { 204: z.void(), 400: errorSchema },
	},
	async ({ actor, params, body }) => {
		await deleteAdminProject(actor, params.key, body);
		return { status: 204 };
	},
);
