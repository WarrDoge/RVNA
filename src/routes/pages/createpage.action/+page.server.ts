import { fail } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "#lib/server/db.ts";
import { HttpError, isHttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { loadPage } from "#lib/server/wiki-edit/common.ts";
import { createDraft, createDraftBody } from "#lib/server/wiki-edit/drafts.ts";
import { editorPageData } from "#lib/server/wiki-edit/editor-page-data.ts";
import type { Actions, PageServerLoad } from "./$types";

function requestedParentId(url: URL) {
	return (
		url.searchParams.get("fromPageId") ?? url.searchParams.get("parentPageId")
	);
}

/**
 * Accepts a page UUID or the numeric source id of an imported page, and resolves
 * either to the page UUID the draft service expects.
 */
async function resolveParentId(raw: string | null) {
	if (raw === null) return null;
	if (z.uuid().safeParse(raw).success) return raw;
	try {
		const { page } = await loadPage(db, raw);
		return page.id;
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 404) {
			throw new HttpError(400, "parentId: Invalid page id");
		}
		throw cause;
	}
}

/** Reads only: SvelteKit runs a load when a link is hovered, so creating a draft here would leak one per hover. */
export const load = pageLoad((event) => {
	event.depends("app:wiki-editor");
	return {
		spaceKey: event.url.searchParams.get("spaceKey"),
		parentId: requestedParentId(event.url),
	};
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ event }, actor) => {
		const spaceKey = event.url.searchParams.get("spaceKey");
		if (!spaceKey) return fail(400, { error: "No space given" });
		const parsed = createDraftBody.safeParse({
			spaceKey,
			parentId: await resolveParentId(requestedParentId(event.url)),
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return fail(400, {
				error: issue
					? issue.path.length > 0
						? `${issue.path.join(".")}: ${issue.message}`
						: issue.message
					: "Invalid request",
			});
		}
		const draft = await createDraft(actor, parsed.data);
		return { editor: await editorPageData(actor, draft.pageId) };
	}),
} satisfies Actions;
