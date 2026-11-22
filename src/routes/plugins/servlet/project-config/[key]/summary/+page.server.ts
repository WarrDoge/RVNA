import { fail } from "@sveltejs/kit";
import { getProjectGitlab } from "#lib/server/gitlab/routes.ts";
import { HttpError, isHttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { ARCHIVED_PROJECT_MESSAGE } from "#lib/server/project-keys.ts";
import {
	createComponent,
	createVersion,
	getProject,
	updateComponent,
	updateProject,
	updateVersion,
} from "#lib/server/projects/service.ts";
import { loadProjectSidebar } from "#lib/server/projects/sidebar.ts";
import { deskSettings } from "#lib/server/servicedesk/service.ts";
import type { Actions, PageServerLoad } from "./$types";

function text(form: FormData, name: string) {
	return String(form.get(name) ?? "");
}

function optionalText(form: FormData, name: string) {
	const value = text(form, name).trim();
	return value === "" ? null : value;
}

function checked(form: FormData, name: string) {
	return form.get(name) !== null;
}

export const load = pageLoad(async (event, actor) => {
	event.depends("app:project");
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
		return { sidebar, project: null, desk: null, gitlab: null };
	}

	const [desk, gitlab] = await Promise.all([
		project.type === "service_desk"
			? deskSettings(actor, event.params.key)
			: Promise.resolve(null),
		actor.isAdmin
			? getProjectGitlab(actor, event.params.key)
			: Promise.resolve(null),
	]);

	return {
		sidebar,
		project: {
			key: project.key,
			name: project.name,
			description: project.description,
			archived: project.archived,
			lead: project.lead,
			components: project.components.map((component) => ({
				id: component.id,
				name: component.name,
				description: component.description,
			})),
			versions: project.versions.map((version) => ({
				id: version.id,
				name: version.name,
				description: version.description,
				startDate: version.startDate,
				releaseDate: version.releaseDate,
				released: version.released,
			})),
		},
		desk,
		gitlab,
	};
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ event, form }, actor) => {
		const project = await getProject(actor, event.params.key);
		if (project.archived) {
			return fail(403, { error: ARCHIVED_PROJECT_MESSAGE });
		}

		const intent = text(form, "intent");
		if (intent === "component") {
			const name = text(form, "name").trim();
			if (name === "") return fail(400, { error: "Enter a component name" });
			const id = text(form, "componentId");
			const body = {
				name,
				description: optionalText(form, "description"),
			};
			if (id === "") await createComponent(actor, event.params.key, body);
			else await updateComponent(actor, id, body);
			return { saved: true };
		}

		if (intent === "version") {
			const name = text(form, "name").trim();
			if (name === "") return fail(400, { error: "Enter a version name" });
			const startDate = text(form, "startDate");
			const releaseDate = text(form, "releaseDate");
			const body = {
				name,
				description: optionalText(form, "description"),
				startDate: startDate === "" ? null : startDate,
				releaseDate: releaseDate === "" ? null : releaseDate,
				released: checked(form, "released"),
			};
			const id = text(form, "versionId");
			if (id === "") await createVersion(actor, event.params.key, body);
			else await updateVersion(actor, id, body);
			return { saved: true };
		}

		const name = text(form, "name").trim();
		if (name === "") return fail(400, { error: "Enter a project name" });
		await updateProject(actor, event.params.key, {
			name,
			description: optionalText(form, "description"),
			leadId: optionalText(form, "leadId"),
		});
		return { saved: true };
	}),
} satisfies Actions;
