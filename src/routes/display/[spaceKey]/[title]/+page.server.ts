import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { loadPageWithTree } from "#lib/server/wiki/read.ts";
import { getPage, resolvePage } from "#lib/server/wiki/service.ts";
import { pageAccess } from "#lib/server/wiki-edit/access.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	const spaceKey = event.params.spaceKey;
	// SvelteKit decodes route params once; decoding again breaks titles with "+" or "%xx".
	const title = event.params.title;
	event.depends("app:wiki-page");

	let resolveFailed = false;
	async function loadTitle(candidate: string) {
		return loadPageWithTree(actor, spaceKey, async () => {
			const resolved = await resolvePage(actor, {
				spaceKey,
				title: candidate,
			}).catch((cause) => {
				resolveFailed = true;
				throw cause;
			});
			return getPage(actor, resolved.id);
		});
	}

	try {
		let loaded: Awaited<ReturnType<typeof loadTitle>>;
		try {
			loaded = await loadTitle(title);
		} catch (cause) {
			// Old Confluence links spell a space in the title as "+".
			if (!isHttpError(cause) || !title.includes("+") || !resolveFailed) {
				throw cause;
			}
			resolveFailed = false;
			loaded = await loadTitle(title.replace(/\+/g, " "));
		}
		const access = await pageAccess(actor, {
			...loaded.page,
			spaceId: loaded.page.space.id,
			creatorId: loaded.page.creator?.id ?? null,
		});
		return {
			page: loaded.page,
			tree: loaded.tree,
			canEdit: access.edit,
			canDelete: access.trash,
			missing: null,
		};
	} catch (cause) {
		if (isHttpError(cause)) {
			return {
				page: null,
				tree: [],
				canEdit: false,
				canDelete: false,
				missing: {
					title: "Page not found",
					message: resolveFailed
						? `No page titled “${title}” exists in ${spaceKey}, or you do not have permission to view it.`
						: "This page does not exist, or you do not have permission to view it.",
				},
			};
		}
		throw cause;
	}
}) satisfies PageServerLoad;
