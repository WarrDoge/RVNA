import { endpoint } from "#lib/server/http.ts";
import { wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { createDraft, createDraftBody } from "#lib/server/wiki-edit/drafts.ts";

export const POST = endpoint(
	{ validationError: wikiValidationError, body: createDraftBody },
	async ({ actor, body }) => {
		const result = await createDraft(actor, body);
		return {
			status: result.created ? 201 : 200,
			body: { pageId: result.pageId, draftId: result.draftId },
		};
	},
);
