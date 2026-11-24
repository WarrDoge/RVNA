import type { IssueActivityData } from "#lib/issue/activity-types.ts";
import type { CurrentUser } from "../auth.ts";
import { requireBrowseIssue } from "../permissions.ts";
import { listComments, listHistory, listWorklogs } from "./service.ts";

/** The display text of a history item, filling it from the raw value where the renderer needs one. */
function historyText(field: string, text: string | null, raw: string | null) {
	if (text !== null || raw === null) return text;
	if (field.toLowerCase().startsWith("time")) return raw;
	if (field === "Attachment" || field === "Link") {
		return raw.startsWith("{") || raw.startsWith("[")
			? field.toLowerCase()
			: raw;
	}
	return null;
}

/**
 * The activity column's first paint: comments, work logs and history. The page
 * checks BROWSE_PROJECTS once and the service functions reuse that context.
 *
 * The page needs only the display strings of history items; raw Jira values can
 * carry hidden custom fields and user objects. The REST endpoint keeps them.
 */
export async function loadIssueActivity(
	actor: CurrentUser,
	key: string,
	context?: Awaited<ReturnType<typeof requireBrowseIssue>>,
): Promise<IssueActivityData> {
	const permission = context ?? (await requireBrowseIssue(actor, key));
	const [comments, worklogs, historyRows] = await Promise.all([
		listComments(actor, key, permission),
		listWorklogs(actor, key, permission),
		listHistory(actor, key, permission),
	]);
	const history = historyRows.map((entry) => ({
		...entry,
		items: entry.items.map(
			({ field, fieldType, from, fromText, to, toText }) => ({
				field,
				fieldType,
				fromText: historyText(field, fromText, from),
				toText: historyText(field, toText, to),
			}),
		),
	}));

	return { comments, worklogs, history };
}
