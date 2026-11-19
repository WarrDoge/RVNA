import { fail } from "@sveltejs/kit";
import {
	createIssueType,
	idParams,
	issueTypeCreateBody,
	issueTypeUpdateBody,
	listIssueTypes,
	updateIssueType,
} from "#lib/server/admin/config.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-config");
	return { issueTypes: await listIssueTypes(actor) };
}) satisfies PageServerLoad;

function field(form: FormData, name: string) {
	const value = form.get(name);
	return typeof value === "string" ? value : "";
}

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const intent = field(form, "intent");
		const description = field(form, "description");
		const body = {
			name: field(form, "name"),
			description: description.trim() === "" ? null : description,
			subtask: field(form, "subtask") === "true",
			icon:
				field(form, "icon") === "" ? null : `builtin:${field(form, "icon")}`,
		};

		if (intent === "create") {
			const parsed = issueTypeCreateBody.safeParse(body);
			if (!parsed.success) {
				return fail(400, {
					error: parsed.error.issues[0]?.message ?? "Invalid issue type",
				});
			}
			await createIssueType(actor, parsed.data);
			return { ok: true };
		}

		if (intent === "update") {
			const id = idParams.safeParse({ id: field(form, "id") });
			const parsed = issueTypeUpdateBody.safeParse(body);
			if (!id.success || !parsed.success) {
				return fail(400, {
					error: parsed.success
						? "Invalid issue type"
						: (parsed.error.issues[0]?.message ?? "Invalid issue type"),
				});
			}
			await updateIssueType(actor, id.data.id, parsed.data);
			return { ok: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
