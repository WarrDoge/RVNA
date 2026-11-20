import { z } from "zod";
import { endpoint, HttpError, isBearer } from "#lib/server/http.ts";
import {
	createToken,
	listTokens,
	tokenCreateSchema,
} from "#lib/server/tokens/service.ts";

const tokenSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	createdAt: z.iso.datetime(),
	lastUsedAt: z.iso.datetime().nullable(),
	expiresAt: z.iso.datetime().nullable(),
});

const createdTokenSchema = tokenSchema.extend({ token: z.string() });

function tokenManager(request: Request) {
	if (isBearer(request)) {
		throw new HttpError(403, "Bearer tokens cannot manage tokens");
	}
}

export const GET = endpoint(
	{ response: z.array(tokenSchema) },
	async ({ actor, event }) => {
		tokenManager(event.request);
		return listTokens(actor);
	},
);

export const POST = endpoint(
	{ body: tokenCreateSchema, response: createdTokenSchema },
	async ({ actor, body, event }) => {
		tokenManager(event.request);
		return { status: 201, body: await createToken(actor, body) };
	},
);
