import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import {
	markNotificationRead,
	unreadSchema,
} from "#lib/server/notifications.ts";

export const POST = endpoint(
	{
		params: z.object({ id: z.uuid() }),
		response: unreadSchema,
	},
	async ({ actor, params }) => markNotificationRead(actor, params.id),
);
