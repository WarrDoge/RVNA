import { fail } from "@sveltejs/kit";
import { HttpError, isHttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import {
	addRoleActor,
	getProjectRoles,
} from "#lib/server/project-roles/service.ts";
import { getProject } from "#lib/server/projects/service.ts";
import { loadProjectSidebar } from "#lib/server/projects/sidebar.ts";
import type { Actions, PageServerLoad } from "./$types";

function text(form: FormData, name: string) {
	return String(form.get(name) ?? "");
}

export const load = pageLoad(async (event, actor) => {
	event.depends("app:project");
	event.depends("app:project-roles");

	const project = await getProject(actor, event.params.key).catch((cause) => {
		if (isHttpError(cause) && cause.status === 404) {
			if (actor.isAdmin) throw cause;
			throw new HttpError(
				403,
				"You do not have permission to administer this project",
			);
		}
		throw cause;
	});
	const sidebar = await loadProjectSidebar(actor, event.params.key, project);
	if (!sidebar.canAdminister) {
		return { sidebar, roles: null };
	}

	return {
		sidebar,
		roles: await getProjectRoles(actor, event.params.key, {
			id: project.id,
			key: project.key,
			name: project.name,
			leadId: project.lead?.id ?? null,
		}),
	};
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ event, form }, actor) => {
		const project = await getProject(actor, event.params.key);
		if (project.archived) {
			return fail(403, { error: "This project is archived and read-only" });
		}
		const roleId = text(form, "roleId");
		if (roleId === "") return fail(400, { error: "Choose a role" });
		const actorType = text(form, "actorType");
		if (actorType !== "user" && actorType !== "group") {
			return fail(400, { error: "Choose a user or group" });
		}
		const actorId = text(form, "actorId");
		if (actorId === "") return fail(400, { error: "Choose a user or group" });
		await addRoleActor(actor, event.params.key, roleId, {
			actorType,
			actorId,
		});
		return { saved: true };
	}),
} satisfies Actions;
