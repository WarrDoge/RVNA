import { error, fail } from "@sveltejs/kit";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { requestParams } from "#lib/server/servicedesk/schemas.ts";
import {
	addPortalComment,
	portalRequestView,
} from "#lib/server/servicedesk/service.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:portal");
	if (!requestParams.safeParse(event.params).success) {
		error(404, "Request not found");
	}
	return portalRequestView(actor, event.params.id, event.params.key);
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ event, form }, actor) => {
		const body = form.get("body");
		if (typeof body !== "string" || body.trim() === "") {
			return fail(400, { error: "Comment body is empty" });
		}
		const result = await addPortalComment(
			actor,
			event.params.id,
			event.params.key,
			body,
		);
		return { commented: result.id };
	}),
} satisfies Actions;
