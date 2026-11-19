import { fail } from "@sveltejs/kit";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import {
	listEditorSpaces,
	listTrash,
	trashPermissions,
} from "#lib/server/wiki-edit/support.ts";
import { purgePage, restorePage } from "#lib/server/wiki-edit/tree.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-trash");
	const spaceKey = event.url.searchParams.get("key");
	if (!spaceKey) return { trash: null };
	const [entries, spaces, permissions] = await Promise.all([
		listTrash(actor, spaceKey),
		listEditorSpaces(actor),
		trashPermissions(actor, spaceKey),
	]);
	return {
		trash: {
			spaceKey,
			entries,
			spaces,
			canRestore: permissions.canRestore,
			canPurge: permissions.canPurge,
		},
	};
}) satisfies PageServerLoad;

export const actions = {
	restore: pageAction(async ({ form }, actor) => {
		const pageId = String(form.get("pageId") ?? "");
		if (!pageId) return fail(400, { error: "No page given." });
		await restorePage(actor, pageId);
		return { restored: pageId };
	}),
	purge: pageAction(async ({ form }, actor) => {
		const pageId = String(form.get("pageId") ?? "");
		if (!pageId) return fail(400, { error: "No page given." });
		await purgePage(actor, pageId);
		return { purged: pageId };
	}),
} satisfies Actions;
