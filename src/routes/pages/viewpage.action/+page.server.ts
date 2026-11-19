import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { getPage, getSpaceTree } from "#lib/server/wiki/service.ts";
import { pageAccess } from "#lib/server/wiki-edit/access.ts";
import type { PageServerLoad } from "./$types";

function asNumber(value: string | null) {
	if (value === null || value.trim() === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export const load = pageLoad(async (event, actor) => {
	const pageId = event.url.searchParams.get("pageId") ?? "";
	const version = asNumber(event.url.searchParams.get("pageVersion"));
	event.depends("app:wiki-page");

	if (pageId === "") {
		return {
			page: null,
			tree: [],
			version,
			canEdit: false,
			canDelete: false,
			missing: {
				title: "Page not found",
				message: "The link is missing a page id.",
			},
		};
	}

	try {
		const page = await getPage(actor, pageId, version);
		const [tree, access] = await Promise.all([
			getSpaceTree(actor, page.space.key),
			pageAccess(actor, {
				...page,
				spaceId: page.space.id,
				creatorId: page.creator?.id ?? null,
			}),
		]);
		return {
			page,
			tree,
			version,
			canEdit: access.edit,
			canDelete: access.trash,
			missing: null,
		};
	} catch (cause) {
		if (isHttpError(cause)) {
			return {
				page: null,
				tree: [],
				version,
				canEdit: false,
				canDelete: false,
				missing: {
					title: "Page not found",
					message:
						"This page does not exist, or you do not have permission to view it.",
				},
			};
		}
		throw cause;
	}
}) satisfies PageServerLoad;
