import { z } from "zod";
import {
	listShareGroups,
	shareGroupSchema,
} from "#lib/server/filters/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ response: z.array(shareGroupSchema) },
	async ({ actor }) => listShareGroups(actor),
);
