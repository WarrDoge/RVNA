import { endpoint } from "#lib/server/http.ts";
import { issueParams } from "#lib/server/issues/schemas.ts";
import { markIssueViewed } from "#lib/server/issues/service.ts";

export const POST = endpoint(
	{ params: issueParams },
	async ({ actor, params }) => {
		await markIssueViewed(actor, params.key);
		return { status: 204 };
	},
);
