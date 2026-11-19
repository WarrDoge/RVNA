import { endpoint } from "#lib/server/http.ts";
import {
	getNotificationSettings,
	notificationSettingsSchema,
	updateNotificationSettings,
} from "#lib/server/notifications.ts";

export const GET = endpoint(
	{ response: notificationSettingsSchema },
	async ({ actor }) => getNotificationSettings(actor),
);

export const PUT = endpoint(
	{
		body: notificationSettingsSchema.partial(),
		response: notificationSettingsSchema,
	},
	async ({ actor, body }) => updateNotificationSettings(actor, body),
);
