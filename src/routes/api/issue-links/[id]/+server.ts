import { endpoint } from "#lib/server/http.ts";
import { linkParams } from "#lib/server/issues/schemas.ts";
import { deleteIssueLink } from "#lib/server/issues/service.ts";

export const DELETE = endpoint(
	{ params: linkParams },
	async ({ actor, params }) => {
		await deleteIssueLink(actor, params.id);
		return { status: 204 };
	},
);
