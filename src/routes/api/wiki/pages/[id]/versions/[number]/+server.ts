import { endpoint } from "#lib/server/http.ts";
import {
	versionDetailSchema,
	versionParams,
} from "#lib/server/wiki/schemas.ts";
import { getPageVersion } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: versionParams, response: versionDetailSchema },
	async ({ actor, params }) => getPageVersion(actor, params.id, params.number),
);
