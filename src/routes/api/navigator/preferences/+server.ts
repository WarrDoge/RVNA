import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import {
	getNavigatorPreferences,
	navigatorPreferencesSchema,
	saveNavigatorPreferences,
} from "#lib/server/navigator/service.ts";

const preferencesBody = z.object({
	view: z.enum(["list", "detail"]).optional(),
	columns: z.array(z.string().min(1).max(200)).max(200).optional(),
});

export const GET = endpoint(
	{ response: navigatorPreferencesSchema },
	async ({ actor }) => getNavigatorPreferences(actor),
);

export const PUT = endpoint(
	{ body: preferencesBody, response: navigatorPreferencesSchema },
	async ({ actor, body }) => saveNavigatorPreferences(actor, body),
);
