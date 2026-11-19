import { z } from "zod";
import {
	createLinkType,
	linkTypeCreateBody,
	linkTypeRowSchema,
	listLinkTypes,
} from "#lib/server/admin/config.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.array(linkTypeRowSchema) },
	async ({ actor }) => listLinkTypes(actor),
);

export const POST = endpoint(
	{
		auth: "admin",
		body: linkTypeCreateBody,
		response: { 201: linkTypeRowSchema, 400: errorSchema },
	},
	async ({ actor, body }) => ({
		status: 201,
		body: await createLinkType(actor, body),
	}),
);
