import {
	favouriteSchema,
	filterParams,
	setFavourite,
} from "#lib/server/filters/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const PUT = endpoint(
	{ params: filterParams, response: favouriteSchema },
	async ({ actor, params }) => setFavourite(actor, params.id, true),
);

export const DELETE = endpoint(
	{ params: filterParams, response: favouriteSchema },
	async ({ actor, params }) => setFavourite(actor, params.id, false),
);
