import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import {
	listNotifications,
	notificationListSchema,
} from "#lib/server/notifications.ts";

const query = z.object({
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(50).default(20),
	tab: z.enum(["all", "direct", "watching"]).default("all"),
});

export const GET = endpoint(
	{ query, response: notificationListSchema },
	async ({ actor, query }) => listNotifications(actor, query),
);
