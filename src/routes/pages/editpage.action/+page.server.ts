import { pageLoad } from "#lib/server/http-svelte.ts";
import { editorPageData } from "#lib/server/wiki-edit/editor-page-data.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-editor");
	const pageId = event.url.searchParams.get("pageId");
	if (!pageId) return { editor: null };
	return { editor: await editorPageData(actor, pageId) };
}) satisfies PageServerLoad;
