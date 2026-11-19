import { fail, redirect } from "@sveltejs/kit";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { pageEditSummary } from "#lib/server/wiki-edit/support.ts";
import { trashPage } from "#lib/server/wiki-edit/tree.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-editor");
	const pageId = event.url.searchParams.get("pageId");
	if (!pageId) return { remove: null };
	const summary = await pageEditSummary(actor, pageId);
	return {
		remove: {
			page: summary.page,
			spaceName: summary.spaceName,
			canDelete: summary.permissions.canDelete,
		},
	};
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ form }, actor) => {
		const pageId = String(form.get("pageId") ?? "");
		if (!pageId) return fail(400, { error: "No page given." });
		const page = await trashPage(actor, pageId);
		redirect(
			303,
			page.parentId
				? `/pages/viewpage.action?pageId=${encodeURIComponent(page.parentId)}`
				: `/display/${encodeURIComponent(page.spaceKey)}`,
		);
	}),
} satisfies Actions;
