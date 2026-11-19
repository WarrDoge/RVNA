import { endpoint } from "#lib/server/http.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { orderBody, reorderChildren } from "#lib/server/wiki-edit/tree.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, params: idParams, body: orderBody },
	async ({ actor, params, body }) => {
		await reorderChildren(actor, params.id, body);
		return { status: 204 };
	},
);
