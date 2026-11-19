import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { getPage, getSpace, getSpaceTree } from "#lib/server/wiki/service.ts";
import { pageAccess } from "#lib/server/wiki-edit/access.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	const key = event.params.spaceKey;
	event.depends("app:wiki-page");
	event.depends("app:wiki-spaces");

	let space: Awaited<ReturnType<typeof getSpace>>;
	let tree: Awaited<ReturnType<typeof getSpaceTree>>;
	try {
		[space, tree] = await Promise.all([
			getSpace(actor, key),
			getSpaceTree(actor, key),
		]);
	} catch (cause) {
		if (isHttpError(cause)) {
			return {
				space: null,
				tree: [],
				page: null,
				pageMissing: false,
				canEdit: false,
				canDelete: false,
			};
		}
		throw cause;
	}

	if (!space.homePage) {
		return {
			space,
			tree,
			page: null,
			pageMissing: false,
			canEdit: false,
			canDelete: false,
		};
	}

	try {
		const page = await getPage(actor, space.homePage.id);
		const access = await pageAccess(actor, {
			...page,
			spaceId: page.space.id,
			creatorId: page.creator?.id ?? null,
		});
		return {
			space,
			tree,
			page,
			pageMissing: false,
			canEdit: access.edit,
			canDelete: access.trash,
		};
	} catch (cause) {
		if (isHttpError(cause)) {
			return {
				space,
				tree,
				page: null,
				pageMissing: true,
				canEdit: false,
				canDelete: false,
			};
		}
		throw cause;
	}
}) satisfies PageServerLoad;
