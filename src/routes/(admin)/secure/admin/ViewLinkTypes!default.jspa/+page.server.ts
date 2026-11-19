import { fail } from "@sveltejs/kit";
import {
	createLinkType,
	idParams,
	linkTypeCreateBody,
	linkTypeUpdateBody,
	listLinkTypes,
	updateLinkType,
} from "#lib/server/admin/config.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-config");
	return { linkTypes: await listLinkTypes(actor) };
}) satisfies PageServerLoad;

function field(form: FormData, name: string) {
	const value = form.get(name);
	return typeof value === "string" ? value : "";
}

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const intent = field(form, "intent");
		const body = {
			name: field(form, "name"),
			outward: field(form, "outward"),
			inward: field(form, "inward"),
		};

		if (intent === "create") {
			const parsed = linkTypeCreateBody.safeParse(body);
			if (!parsed.success) {
				return fail(400, {
					error: parsed.error.issues[0]?.message ?? "Invalid link type",
				});
			}
			await createLinkType(actor, parsed.data);
			return { ok: true };
		}

		if (intent === "update") {
			const id = idParams.safeParse({ id: field(form, "id") });
			const parsed = linkTypeUpdateBody.safeParse(body);
			if (!id.success || !parsed.success) {
				return fail(400, {
					error: parsed.success
						? "Invalid link type"
						: (parsed.error.issues[0]?.message ?? "Invalid link type"),
				});
			}
			await updateLinkType(actor, id.data.id, parsed.data);
			return { ok: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
