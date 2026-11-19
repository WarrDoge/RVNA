import type { IssueActivityData } from "#lib/issue/activity-types.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { fields } from "../schema.ts";
import { listComments, listHistory, listWorklogs } from "./service.ts";

/**
 * Field names and ids the issue screen must not render in history: the service
 * desk's internal fields. Sprint, Rank and the epic fields stay; they are
 * internal only for the custom fields panel.
 */
async function hiddenHistoryFields() {
	const rows = await db
		.select({
			sourceId: fields.sourceId,
			name: fields.name,
			customKey: fields.customKey,
			type: fields.type,
		})
		.from(fields);
	const hidden = new Set<string>();
	for (const row of rows) {
		const serviceDesk =
			row.customKey?.startsWith("com.atlassian.servicedesk") ||
			row.type?.startsWith("sd-");
		if (!serviceDesk) continue;
		hidden.add(row.name.toLowerCase());
		hidden.add(row.sourceId.toLowerCase());
	}
	return hidden;
}

/**
 * The activity column's first paint: comments, work logs and history. Each
 * service function applies the same guards as its REST endpoint.
 *
 * The page needs only the display strings of history items; raw Jira values can
 * carry hidden custom fields and user objects. The REST endpoint keeps them.
 */
export async function loadIssueActivity(
	actor: CurrentUser,
	key: string,
): Promise<IssueActivityData> {
	const [comments, worklogs, historyRows, hiddenFields] = await Promise.all([
		listComments(actor, key),
		listWorklogs(actor, key),
		listHistory(actor, key),
		hiddenHistoryFields(),
	]);

	const history = historyRows
		.map((entry) => ({
			...entry,
			items: entry.items
				.filter((item) => !hiddenFields.has(item.field.toLowerCase()))
				.map(({ field, fieldType, fromText, toText }) => ({
					field,
					fieldType,
					fromText,
					toText,
				})),
		}))
		.filter((entry) => entry.items.length > 0);

	return { comments, worklogs, history };
}
