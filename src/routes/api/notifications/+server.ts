import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import {
	listNotifications,
	notificationListSchema,
} from "#lib/server/notifications.ts";
import { offsetQuery } from "#lib/server/paging.ts";

const query = z.object({
	offset: offsetQuery,
	limit: z.coerce.number().int().min(1).max(50).default(20),
	tab: z.enum(["all", "direct", "watching"]).default("all"),
});

export const GET = endpoint(
	{ query, response: notificationListSchema },
	async ({ actor, query }) => listNotifications(actor, query),
);
