import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	messengerTestSchema,
	testMessengerConnection,
} from "#lib/server/messenger/routes.ts";

export const POST = endpoint(
	{ auth: "admin", response: { 200: messengerTestSchema, 400: errorSchema } },
	async ({ actor }) => testMessengerConnection(actor),
);
