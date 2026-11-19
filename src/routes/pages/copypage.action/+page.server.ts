import { pageLoad } from "#lib/server/http-svelte.ts";
import {
	getSpaceTree,
	listEditorSpaces,
	pageEditSummary,
} from "#lib/server/wiki-edit/support.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-editor");
	const id = event.url.searchParams.get("idOfPageToCopy");
	if (!id) return { copy: null };
	const summary = await pageEditSummary(actor, id);
	const [spaces, tree] = await Promise.all([
		listEditorSpaces(actor),
		getSpaceTree(actor, summary.page.spaceKey),
	]);
	return {
		copy: {
			page: summary.page,
			spaces,
			tree,
		},
	};
}) satisfies PageServerLoad;
