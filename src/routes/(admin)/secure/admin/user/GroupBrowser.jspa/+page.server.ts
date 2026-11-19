import { fail } from "@sveltejs/kit";
import {
	createGroup,
	groupCreateBody,
	listGroups,
} from "#lib/server/admin/groups.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-groups");
	return { groups: await listGroups(actor, { query: "" }) };
}) satisfies PageServerLoad;

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const parsed = groupCreateBody.safeParse({ name: form.get("name") });
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid group name",
			});
		}
		return createGroup(actor, parsed.data);
	}),
} satisfies Actions;
