import { fail } from "@sveltejs/kit";
import {
	createStatus,
	idParams,
	listStatuses,
	statusCreateBody,
	statusUpdateBody,
	updateStatus,
} from "#lib/server/admin/config.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-config");
	return { statuses: await listStatuses(actor) };
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
			category: field(form, "category"),
		};

		if (intent === "create") {
			const parsed = statusCreateBody.safeParse(body);
			if (!parsed.success) {
				return fail(400, {
					error: parsed.error.issues[0]?.message ?? "Invalid status",
				});
			}
			await createStatus(actor, parsed.data);
			return { ok: true };
		}

		if (intent === "update") {
			const id = idParams.safeParse({ id: field(form, "id") });
			const parsed = statusUpdateBody.safeParse(body);
			if (!id.success || !parsed.success) {
				return fail(400, {
					error: parsed.success
						? "Invalid status"
						: (parsed.error.issues[0]?.message ?? "Invalid status"),
				});
			}
			await updateStatus(actor, id.data.id, parsed.data);
			return { ok: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
