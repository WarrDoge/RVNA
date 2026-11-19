import { z } from "zod";
import { endpoint, HttpError, isBearer } from "#lib/server/http.ts";
import { revokeToken } from "#lib/server/tokens/service.ts";

export const DELETE = endpoint(
	{ params: z.object({ id: z.uuid() }) },
	async ({ actor, params, event }) => {
		if (isBearer(event.request)) {
			throw new HttpError(403, "Bearer tokens cannot manage tokens");
		}
		await revokeToken(actor, params.id);
		return { status: 204 };
	},
);
