import { fail } from "@sveltejs/kit";
import {
	createResolution,
	idParams,
	listResolutions,
	resolutionCreateBody,
	resolutionUpdateBody,
	updateResolution,
} from "#lib/server/admin/config.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-config");
	return {
		resolutions: (await listResolutions(actor)).map(
			({ sequence: _sequence, ...resolution }) => resolution,
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
		const description = field(form, "description");
		const body = {
			name: field(form, "name"),
			description: description.trim() === "" ? null : description,
		};

		if (intent === "create") {
			const parsed = resolutionCreateBody.safeParse(body);
			if (!parsed.success) {
				return fail(400, {
					error: parsed.error.issues[0]?.message ?? "Invalid resolution",
				});
			}
			await createResolution(actor, parsed.data);
			return { ok: true };
		}

		if (intent === "update") {
			const id = idParams.safeParse({ id: field(form, "id") });
			const parsed = resolutionUpdateBody.safeParse(body);
			if (!id.success || !parsed.success) {
				return fail(400, {
					error: parsed.success
						? "Invalid resolution"
						: (parsed.error.issues[0]?.message ?? "Invalid resolution"),
				});
			}
			await updateResolution(actor, id.data.id, parsed.data);
			return { ok: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
