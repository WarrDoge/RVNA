import { redirect } from "@sveltejs/kit";
import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { loadIssueView } from "#lib/server/issues/view.ts";
import { projectPage } from "#lib/server/project-keys/service.ts";
import { loadProjectSidebar } from "#lib/server/projects/sidebar.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	const requested = event.params.key;
	const resolved = requested.toUpperCase();

	// The old address redirects a previous project key, a project key to its
	// summary, and a customer to the portal request, exactly like the endpoint.
	const outcome = await projectPage(actor, {
		pathname: event.url.pathname,
		search: event.url.search,
		resolvedKey: resolved,
	});
	if (outcome.kind === "redirect") redirect(302, outcome.location);

	const view = await loadIssueView(actor, resolved);
	if (view.issue.key !== requested) {
		redirect(
			302,
			`/browse/${encodeURIComponent(view.issue.key)}${event.url.search}`,
		);
	}

	event.depends(`app:issue:${view.issue.key}`);
	event.depends("app:project-sidebar");

	// An issue-only reporter or assignee may read the issue but not the project;
	// the issue page still renders, without the project frame.
	let sidebar: Awaited<ReturnType<typeof loadProjectSidebar>> | null = null;
	try {
		sidebar = await loadProjectSidebar(actor, view.issue.project.key);
	} catch (cause) {
		if (!isHttpError(cause) || cause.status !== 404) throw cause;
	}

	return { view, sidebar };
}) satisfies PageServerLoad;
