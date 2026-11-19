import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	clearMessengerAccessToken,
	messengerSettingsSchema,
	messengerTokenBody,
	saveMessengerAccessToken,
} from "#lib/server/messenger/routes.ts";

export const PUT = endpoint(
	{
		auth: "admin",
		body: messengerTokenBody,
		response: { 200: messengerSettingsSchema, 400: errorSchema },
	},
	async ({ actor, body }) => saveMessengerAccessToken(actor, body),
);

export const DELETE = endpoint(
	{ auth: "admin", response: messengerSettingsSchema },
	async ({ actor }) => clearMessengerAccessToken(actor),
);
