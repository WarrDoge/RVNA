import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	createMessengerLinkCode,
	disconnectMessenger,
	messengerProfileInfo,
} from "#lib/server/messenger/links.ts";

const profileSchema = z.object({
	linkedMatrixId: z.string().nullable(),
	botMatrixId: z.string().nullable(),
	serverName: z.string().nullable(),
	enabled: z.boolean(),
});

const codeSchema = z.object({
	code: z.string(),
	expiresAt: z.string(),
	botMatrixId: z.string(),
});

export const GET = endpoint({ response: profileSchema }, async ({ actor }) =>
	messengerProfileInfo(actor),
);

export const POST = endpoint(
	{ response: { 200: codeSchema, 400: errorSchema } },
	async ({ actor }) => createMessengerLinkCode(actor),
);

export const DELETE = endpoint({ response: profileSchema }, async ({ actor }) =>
	disconnectMessenger(actor),
);
