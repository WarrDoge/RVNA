import { z } from "zod";
import {
	createGroup,
	groupCreateBody,
	groupDetailResponseSchema,
	groupListQuery,
	groupSummarySchema,
	listGroups,
} from "#lib/server/admin/groups.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		auth: "admin",
		query: groupListQuery,
		response: z.array(groupSummarySchema),
	},
	async ({ actor, query }) => listGroups(actor, query),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: groupCreateBody,
		response: { 201: groupDetailResponseSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createGroup(actor, body),
	}),
);
