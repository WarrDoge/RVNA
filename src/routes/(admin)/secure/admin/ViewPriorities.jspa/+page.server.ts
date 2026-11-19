import { fail } from "@sveltejs/kit";
import {
	createPriority,
	idParams,
	listPriorities,
	priorityCreateBody,
	priorityUpdateBody,
	updatePriority,
} from "#lib/server/admin/config.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-config");
	return {
		priorities: (await listPriorities(actor)).map(
			({ sequence: _sequence, ...priority }) => priority,
		),
	};
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
			iconColor: field(form, "iconColor"),
		};

		if (intent === "create") {
			const parsed = priorityCreateBody.safeParse(body);
			if (!parsed.success) {
				return fail(400, {
					error: parsed.error.issues[0]?.message ?? "Invalid priority",
				});
			}
			await createPriority(actor, parsed.data);
			return { ok: true };
		}

		if (intent === "update") {
			const id = idParams.safeParse({ id: field(form, "id") });
			const parsed = priorityUpdateBody.safeParse(body);
			if (!id.success || !parsed.success) {
				return fail(400, {
					error: parsed.success
						? "Invalid priority"
						: (parsed.error.issues[0]?.message ?? "Invalid priority"),
				});
			}
			await updatePriority(actor, id.data.id, parsed.data);
			return { ok: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
