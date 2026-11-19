import { endpoint } from "#lib/server/http.ts";
import {
	unreadNotifications,
	unreadSchema,
} from "#lib/server/notifications.ts";

export const GET = endpoint({ response: unreadSchema }, async ({ actor }) =>
	unreadNotifications(actor),
);
