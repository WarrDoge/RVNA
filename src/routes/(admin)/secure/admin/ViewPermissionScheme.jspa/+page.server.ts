import { fail } from "@sveltejs/kit";
import { listGroups } from "#lib/server/admin/groups.ts";
import {
	addPermissionGrant,
	assignBody,
	assignPermissionSchemeProject,
	createGrantBody,
	getPermissionScheme,
	grantParams,
	removePermissionGrant,
	schemeParams,
} from "#lib/server/admin/permission-schemes.ts";
import { listAdminProjects } from "#lib/server/admin/projects.ts";
import { isHttpError } from "#lib/server/http.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-permission-scheme");
	const id = event.url.searchParams.get("id") ?? "";
	if (id === "") {
		return {
			id,
			detail: null,
			error: null,
			groups: [],
			projects: [],
		};
	}
	if (!schemeParams.safeParse({ id }).success) {
		return {
			id,
			detail: null,
			error: "Permission scheme not found",
			groups: [],
			projects: [],
		};
	}
	try {
		const [detail, groups, projects] = await Promise.all([
			getPermissionScheme(actor, id),
			listGroups(actor, { query: "" }),
			listAdminProjects(actor, { query: "", archived: "all" }),
		]);
		const { scheme } = detail;
		return {
			id,
			detail: {
				...detail,
				scheme: {
					id: scheme.id,
					name: scheme.name,
					description: scheme.description,
					source: scheme.source,
					projects: scheme.projects,
				},
			},
			error: null,
			groups: groups.map((group) => ({ id: group.id, name: group.name })),
			projects: projects.map((project) => ({
				id: project.id,
				key: project.key,
				name: project.name,
			})),
		};
	} catch (cause) {
		if (isHttpError(cause)) {
			return {
				id,
				detail: null,
				error: cause.message,
				groups: [],
				projects: [],
			};
		}
		throw cause;
	}
}) satisfies PageServerLoad;

function message(error: { issues: { message: string }[] }) {
	return error.issues[0]?.message ?? "Invalid permission grant";
}

function validSchemeId(form: FormData) {
	const parsed = schemeParams.safeParse({
		id: String(form.get("schemeId") ?? ""),
	});
	return parsed.success ? parsed.data.id : null;
}

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const intent = String(form.get("intent") ?? "");

		if (intent === "addGrant") {
			const id = validSchemeId(form);
			if (id === null) {
				return fail(404, { error: "Permission scheme not found" });
			}
			const holderParameter = String(form.get("holderParameter") ?? "");
			const parsed = createGrantBody.safeParse({
				permissionKey: String(form.get("permissionKey") ?? ""),
				holderType: String(form.get("holderType") ?? ""),
				...(holderParameter === "" ? {} : { holderParameter }),
			});
			if (!parsed.success) return fail(400, { error: message(parsed.error) });
			await addPermissionGrant(actor, id, parsed.data);
			return { ok: true };
		}

		if (intent === "removeGrant") {
			const parsed = grantParams.safeParse({
				id: String(form.get("schemeId") ?? ""),
				grantId: String(form.get("grantId") ?? ""),
			});
			if (!parsed.success) {
				return fail(404, { error: "Permission grant not found" });
			}
			await removePermissionGrant(actor, parsed.data.id, parsed.data.grantId);
			return { ok: true };
		}

		if (intent === "assign") {
			const id = validSchemeId(form);
			if (id === null) {
				return fail(404, { error: "Permission scheme not found" });
			}
			const parsed = assignBody.safeParse({
				projectId: String(form.get("projectId") ?? ""),
			});
			if (!parsed.success) return fail(400, { error: message(parsed.error) });
			await assignPermissionSchemeProject(actor, id, parsed.data);
			return { ok: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
