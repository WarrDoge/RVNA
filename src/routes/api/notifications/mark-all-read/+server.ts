import { endpoint } from "#lib/server/http.ts";
import {
	markAllNotificationsRead,
	unreadSchema,
} from "#lib/server/notifications.ts";

export const POST = endpoint({ response: unreadSchema }, async ({ actor }) =>
	markAllNotificationsRead(actor),
);
