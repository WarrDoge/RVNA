import { eq } from "drizzle-orm";
import type { IssueDetail, Me } from "../../api-types.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { issues, projects } from "../schema.ts";
import { issueDetailWithCustomFieldsSchema } from "./schemas.ts";
import { getIssue, listResolutions } from "./service.ts";
import { loadIssueActivity } from "./view-activity.ts";
import { loadIssuePanels } from "./view-panels.ts";

/** Everything the first paint of the issue view renders. */
export type IssueView = Awaited<ReturnType<typeof loadIssueView>>;

/**
 * `archived` for the already-authorized issue. The issue page must not depend on
 * project-level BROWSE_PROJECTS, which an issue-only reporter or assignee lacks.
 */
async function projectArchived(key: string) {
	const [row] = await db
		.select({ archived: projects.archived })
		.from(issues)
		.innerJoin(projects, eq(projects.id, issues.projectId))
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	return row?.archived ?? false;
}

/**
 * The issue view of one key: the issue, the viewer, the archived flag and the
 * three sibling loader bundles. `getIssue` checks BROWSE_PROJECTS itself; each
 * sibling loader checks its own permission the way its REST endpoints do.
 */
export async function loadIssueView(actor: CurrentUser, key: string) {
	// The endpoint serialises through this schema; the page data must match it.
	const issuePromise = getIssue(actor, key).then(
		(issue) =>
			issueDetailWithCustomFieldsSchema.parse(issue) as unknown as IssueDetail,
	);
	const [issue, activity, panels, archived, resolutions] = await Promise.all([
		issuePromise,
		loadIssueActivity(actor, key),
		loadIssuePanels(actor, key),
		projectArchived(key),
		listResolutions(),
	]);

	return {
		issue,
		me: actor as Me,
		project: { archived },
		activity,
		panels,
		resolutions,
	};
}
