import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { getSpaceTree } from "#lib/server/wiki-edit/support.ts";

export const GET = endpoint(
	{
		validationError: wikiValidationError,
		params: z.object({ spaceKey: z.string().min(1) }),
	},
	async ({ actor, params }) => getSpaceTree(actor, params.spaceKey),
);
