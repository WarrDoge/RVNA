import { z } from "zod";
import {
	createIssueType,
	issueTypeCreateBody,
	issueTypeRowSchema,
	listIssueTypes,
} from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.array(issueTypeRowSchema) },
	async ({ actor }) => listIssueTypes(actor),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: issueTypeCreateBody,
		response: { 201: issueTypeRowSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createIssueType(actor, body),
	}),
);
