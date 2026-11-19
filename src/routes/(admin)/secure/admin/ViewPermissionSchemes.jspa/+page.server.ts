import { fail } from "@sveltejs/kit";
import {
	copyBody,
	copyPermissionScheme,
	listPermissionSchemes,
	schemeParams,
} from "#lib/server/admin/permission-schemes.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-permission-schemes");
	const { schemes } = await listPermissionSchemes(actor);
	return {
		schemes: schemes.map(({ id, name, description, source, projects }) => ({
			id,
			name,
			description,
			source,
			projects,
		})),
	};
}) satisfies PageServerLoad;

function message(error: { issues: { message: string }[] }) {
	return error.issues[0]?.message ?? "Invalid permission scheme";
}

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		if (String(form.get("intent") ?? "") !== "copy") {
			return fail(400, { error: "Unknown action" });
		}
		const id = String(form.get("schemeId") ?? "");
		if (!schemeParams.safeParse({ id }).success) {
			return fail(404, { error: "Permission scheme not found" });
		}
		const parsed = copyBody.safeParse({
			name: String(form.get("name") ?? ""),
		});
		if (!parsed.success) return fail(400, { error: message(parsed.error) });
		const result = await copyPermissionScheme(actor, id, parsed.data);
		return { scheme: { id: result.scheme.id, name: result.scheme.name } };
	}),
} satisfies Actions;
