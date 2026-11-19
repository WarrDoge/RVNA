import { z } from "zod";
import { endpoint, HttpError, isBearer } from "#lib/server/http.ts";
import { createToken, listTokens } from "#lib/server/tokens/service.ts";

const tokenSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	createdAt: z.iso.datetime(),
	lastUsedAt: z.iso.datetime().nullable(),
	expiresAt: z.iso.datetime().nullable(),
});

const createdTokenSchema = tokenSchema.extend({ token: z.string() });

const createSchema = z.object({
	name: z.string().trim().min(1).max(200),
	expiresInDays: z.number().int().positive().max(3650).optional(),
});

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
	{ body: createSchema, response: createdTokenSchema },
	async ({ actor, body, event }) => {
		tokenManager(event.request);
		return { status: 201, body: await createToken(actor, body) };
	},
);
