import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	getMessengerSettings,
	messengerSettingsBody,
	messengerSettingsSchema,
	saveMessengerSettings,
} from "#lib/server/messenger/routes.ts";

export const GET = endpoint(
	{ auth: "admin", response: messengerSettingsSchema },
	async ({ actor }) => getMessengerSettings(actor),
);

export const PUT = endpoint(
	{
		auth: "admin",
		body: messengerSettingsBody,
		response: { 200: messengerSettingsSchema, 400: errorSchema },
	},
	async ({ actor, body }) => saveMessengerSettings(actor, body),
);
