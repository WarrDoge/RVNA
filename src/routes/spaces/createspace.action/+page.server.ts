import { fail, redirect } from "@sveltejs/kit";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { createSpace, createSpaceBody } from "#lib/server/wiki-edit/spaces.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = pageLoad((_event, actor) => ({
	isAdmin: actor.isAdmin,
})) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ form }, actor) => {
		const parsed = createSpaceBody.safeParse({
			key: String(form.get("key") ?? ""),
			name: String(form.get("name") ?? ""),
			description:
				String(form.get("description") ?? "").trim() === ""
					? undefined
					: String(form.get("description") ?? ""),
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid request",
			});
		}
		const space = await createSpace(actor, parsed.data);
		redirect(
			303,
			space.homePageId
				? `/pages/viewpage.action?pageId=${encodeURIComponent(space.homePageId)}`
				: `/display/${encodeURIComponent(space.key)}`,
		);
	}),
} satisfies Actions;
