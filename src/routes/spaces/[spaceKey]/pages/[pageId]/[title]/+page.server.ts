import { redirect } from "@sveltejs/kit";
import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { loadPageWithTree } from "#lib/server/wiki/read.ts";
import { getPage } from "#lib/server/wiki/service.ts";
import { pageAccess } from "#lib/server/wiki-edit/access.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-page");

	try {
		const { page, tree } = await loadPageWithTree(
			actor,
			event.params.spaceKey,
			() => getPage(actor, event.params.pageId),
		);
		const access = await pageAccess(actor, {
			...page,
			spaceId: page.space.id,
			creatorId: page.creator?.id ?? null,
		});
		const canonical = `/spaces/${encodeURIComponent(page.space.key)}/pages/${encodeURIComponent(
			event.params.pageId,
		)}/${encodeURIComponent(page.title)}`;
		if (
			event.params.spaceKey.toLowerCase() !== page.space.key.toLowerCase() ||
			event.params.title !== page.title
		) {
			redirect(302, canonical);
		}
		return {
			page,
			tree,
			missing: null,
			canEdit: access.edit,
			canDelete: access.trash,
		};
	} catch (cause) {
		if (isHttpError(cause)) {
			return {
				page: null,
				tree: [],
				missing: {
					title: "Page not found",
					message:
						"This page does not exist, or you do not have permission to view it.",
				},
				canEdit: false,
				canDelete: false,
			};
		}
		throw cause;
	}
}) satisfies PageServerLoad;
