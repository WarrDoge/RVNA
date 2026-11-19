import { isSidebarActive, type SidebarActive } from "#lib/project/types.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { listProjects } from "#lib/server/projects/service.ts";
import { loadProjectSidebar } from "#lib/server/projects/sidebar.ts";
import type { PageServerLoad } from "./$types";

function activeFrom(value: string | null): SidebarActive {
	return isSidebarActive(value) ? value : "board";
}

export const load = pageLoad(async (event, actor) => {
	event.depends("app:project-sidebar");
	const requested = event.url.searchParams.get("project")?.trim().toUpperCase();
	const projectKey =
		requested || (await listProjects(actor))[0]?.key.toUpperCase() || "";
	const active = activeFrom(event.url.searchParams.get("active"));

	if (!projectKey) {
		return { sidebar: null, active, projectKey: "" };
	}

	return {
		sidebar: await loadProjectSidebar(actor, projectKey),
		active,
		projectKey,
	};
}) satisfies PageServerLoad;
