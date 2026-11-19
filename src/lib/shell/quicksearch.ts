import type { QuickSearchResult } from "#lib/api-types.ts";

/** The address of the active result row, or null when the row list is empty. */
export function resultPath(
	results: QuickSearchResult | null,
	index: number,
): string | null {
	if (!results) return null;
	const issue = results.issues[index];
	if (issue) return `/browse/${issue.key}`;
	const project = results.projects[index - results.issues.length];
	if (project) return `/projects/${project.key}/issues`;
	const page =
		results.pages[index - results.issues.length - results.projects.length];
	if (page) return `/pages/${page.id}`;
	return null;
}
