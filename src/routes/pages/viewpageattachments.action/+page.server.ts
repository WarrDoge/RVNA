import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { readPageMeta } from "#lib/server/wiki/read.ts";
import {
	getPage,
	getSpaceTree,
	listPageAttachments,
} from "#lib/server/wiki/service.ts";
import { pageAccess } from "#lib/server/wiki-edit/access.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	const pageId = event.url.searchParams.get("pageId") ?? "";
	event.depends("app:wiki-attachments");
	event.depends("app:wiki-page");

	if (pageId === "") {
		return {
			page: null,
			attachments: [],
			tree: [],
			canEdit: false,
			missing: true,
		};
	}

	try {
		const page = await getPage(actor, pageId);
		const [attachments, tree, access] = await Promise.all([
			listPageAttachments(actor, page.id),
			getSpaceTree(actor, page.space.key),
			pageAccess(actor, {
				...page,
				spaceId: page.space.id,
				creatorId: page.creator?.id ?? null,
			}),
		]);
		return {
			page: readPageMeta(page),
			attachments: attachments.map((attachment) => ({
				...attachment,
				canDelete: actor.isAdmin || attachment.author?.id === actor.id,
			})),
			tree,
			canEdit: access.edit,
			missing: false,
		};
	} catch (cause) {
		if (isHttpError(cause)) {
			return {
				page: null,
				attachments: [],
				tree: [],
				canEdit: false,
				missing: true,
			};
		}
		throw cause;
	}
}) satisfies PageServerLoad;
