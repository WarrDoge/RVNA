import type { IssueDetail, Me } from "../../api-types.ts";
import type { CurrentUser } from "../auth.ts";
import { requireBrowseIssue } from "../permissions.ts";
import { issueDetailWithCustomFieldsSchema } from "./schemas.ts";
import { getIssue, listResolutions } from "./service.ts";
import { loadIssueActivity } from "./view-activity.ts";
import { loadIssuePanels } from "./view-panels.ts";

/** Everything the first paint of the issue view renders. */
export type IssueView = Awaited<ReturnType<typeof loadIssueView>>;

/**
 * The issue view of one key: the issue, the viewer, the archived flag and the
 * three sibling loader bundles. One BROWSE_PROJECTS check serves the issue and
 * both sibling loaders.
 */
export async function loadIssueView(actor: CurrentUser, key: string) {
	const context = await requireBrowseIssue(actor, key);
	// The endpoint serialises through this schema; the page data must match it.
	const issuePromise = getIssue(actor, key, context).then((issue) => ({
		issue: issueDetailWithCustomFieldsSchema.parse(issue) satisfies IssueDetail,
		archived: issue.projectArchived,
	}));
	const [loaded, activity, panels, resolutions] = await Promise.all([
		issuePromise,
		loadIssueActivity(actor, key, context),
		loadIssuePanels(actor, key, context),
		listResolutions(),
	]);

	return {
		issue: loaded.issue,
		me: actor satisfies Me,
		project: { archived: loaded.archived },
		activity,
		panels,
		resolutions,
	};
}
