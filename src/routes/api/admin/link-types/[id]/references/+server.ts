import {
	getLinkTypeReferences,
	idParams,
	referencesSchema,
} from "#lib/server/admin/config.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", params: idParams, response: referencesSchema },
	async ({ actor, params }) => getLinkTypeReferences(actor, params.id),
);
