import { endpoint } from "#lib/server/http.ts";
import { likeSchema, pageParams } from "#lib/server/wiki/schemas.ts";
import { togglePageLike } from "#lib/server/wiki/service.ts";

export const POST = endpoint(
	{ params: pageParams, response: likeSchema },
	async ({ actor, params }) => togglePageLike(actor, params.id),
);
