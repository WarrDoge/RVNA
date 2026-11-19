import { z } from "zod";
import { HttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { draftEditorPageData } from "#lib/server/wiki-edit/editor-page-data.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-editor");
	const draftId = event.url.searchParams.get("draftId");
	if (!draftId) return { editor: null };
	if (!z.uuid().safeParse(draftId).success) {
		throw new HttpError(404, "Draft not found");
	}
	return { editor: await draftEditorPageData(actor, draftId) };
}) satisfies PageServerLoad;
