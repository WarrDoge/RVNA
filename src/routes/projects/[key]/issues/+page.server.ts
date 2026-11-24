import { pageLoad } from "#lib/server/http-svelte.ts";
import { offsetParam } from "#lib/server/paging.ts";
import { listProjectIssues } from "#lib/server/projects/service.ts";
import { loadProjectSidebar } from "#lib/server/projects/sidebar.ts";
import type { PageServerLoad } from "./$types";

const pageSize = 50;

function pageIssues(result: Awaited<ReturnType<typeof listProjectIssues>>) {
	return {
		total: result.total,
		offset: result.offset,
		limit: result.limit,
		issues: result.issues.map((issue) => ({
			id: issue.id,
			key: issue.key,
			summary: issue.summary,
			type: {
				id: issue.type.id,
				name: issue.type.name,
				iconUrl: issue.type.iconUrl,
			},
			status: issue.status,
			priority: issue.priority
				? {
						id: issue.priority.id,
						name: issue.priority.name,
						iconUrl: issue.priority.iconUrl,
					}
				: null,
			resolution: issue.resolution
				? { id: issue.resolution.id, name: issue.resolution.name }
				: null,
			assignee: issue.assignee
				? { id: issue.assignee.id, displayName: issue.assignee.displayName }
				: null,
			reporter: issue.reporter
				? { id: issue.reporter.id, displayName: issue.reporter.displayName }
				: null,
			created: issue.created,
			updated: issue.updated,
		})),
	};
}

export const load = pageLoad(async (event, actor) => {
	const offset = offsetParam(event.url.searchParams.get("offset"));

	const [sidebar, initial] = await Promise.all([
		loadProjectSidebar(actor, event.params.key),
		listProjectIssues(actor, event.params.key, {
			offset,
			limit: pageSize,
		}),
	]);

	const lastOffset =
		Math.max(0, Math.ceil(initial.total / pageSize) - 1) * pageSize;
	const issues = pageIssues(
		offset > lastOffset
			? await listProjectIssues(actor, event.params.key, {
					offset: lastOffset,
					limit: pageSize,
				})
			: initial,
	);

	return {
		sidebar,
		issues,
		offset: Math.min(offset, lastOffset),
		archived: sidebar.archived,
	};
}) satisfies PageServerLoad;
