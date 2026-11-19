import { pageLoad } from "#lib/server/http-svelte.ts";
import {
	getSpaceTree,
	listEditorSpaces,
	pageEditSummary,
} from "#lib/server/wiki-edit/support.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-editor");
	const pageId = event.url.searchParams.get("pageId");
	if (!pageId) return { move: null };
	const summary = await pageEditSummary(actor, pageId);
	const [spaces, tree] = await Promise.all([
		listEditorSpaces(actor),
		getSpaceTree(actor, summary.page.spaceKey),
	]);
	return {
		move: {
			page: summary.page,
			spaceName: summary.spaceName,
			breadcrumb: summary.breadcrumb,
			spaces,
			tree,
		},
	};
}) satisfies PageServerLoad;
