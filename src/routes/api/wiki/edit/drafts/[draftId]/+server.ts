import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { getDraftContext } from "#lib/server/wiki-edit/support.ts";

export const GET = endpoint(
	{
		validationError: wikiValidationError,
		params: z.object({ draftId: z.uuid() }),
	},
	async ({ actor, params }) => getDraftContext(actor, params.draftId),
);
