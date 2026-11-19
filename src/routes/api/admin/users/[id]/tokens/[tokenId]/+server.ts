import { revokeUserToken, tokenParams } from "#lib/server/admin/users.ts";
import { endpoint } from "#lib/server/http.ts";

export const DELETE = endpoint(
	{ auth: "admin", params: tokenParams },
	async ({ actor, params }) => {
		await revokeUserToken(actor, params.id, params.tokenId);
		return { status: 204 };
	},
);
