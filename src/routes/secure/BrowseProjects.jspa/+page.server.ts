import { pageLoad } from "#lib/server/http-svelte.ts";
import { listProjects } from "#lib/server/projects/service.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (_event, actor) => {
	const projects = await listProjects(actor);
	return {
		projects: projects.map((project) => ({
			id: project.id,
			key: project.key,
			name: project.name,
			type: project.type,
			avatarUrl: project.avatarUrl,
			lead: project.lead ? { displayName: project.lead.displayName } : null,
			category: project.category,
		})),
	};
}) satisfies PageServerLoad;
