import { fail } from "@sveltejs/kit";
import {
	addGlobalPermission,
	addHolderBody,
	listGlobalPermissions,
} from "#lib/server/admin/global-permissions.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-global-permissions");
	return listGlobalPermissions(actor);
}) satisfies PageServerLoad;

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const parsed = addHolderBody.safeParse({
			holderType: form.get("holderType"),
			holderParameter: form.get("holderParameter"),
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid holder",
			});
		}
		return addGlobalPermission(actor, parsed.data);
	}),
} satisfies Actions;
